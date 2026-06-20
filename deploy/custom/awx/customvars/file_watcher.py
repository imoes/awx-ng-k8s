# awx-ng: watches ansible project directories for external changes and
# re-extracts role variables when defaults/main.yml or vars/main.yml is modified.
import logging
import os
import pathlib
import re
import subprocess
import threading
import time

log = logging.getLogger('awx.customvars.file_watcher')

_DEBOUNCE = 1.5  # seconds between last change and actual DB update

# _pending: (project_dir_str, role_name) → deadline (monotonic)
_pending: dict = {}
_lock = threading.Lock()
_timer = None

# Matches: .../roles/<role_name>/defaults/something.yml
#          .../roles/<role_name>/vars/something.yml
_ROLE_VAR_RE = re.compile(r'(.*)/roles/([^/]+)/(?:defaults|vars)/[^/]+\.ya?ml$')


def _debounce(project_dir: str, role_name: str):
    global _timer
    key = (project_dir, role_name)
    deadline = time.monotonic() + _DEBOUNCE
    with _lock:
        _pending[key] = deadline
        if _timer:
            _timer.cancel()
        t = threading.Timer(_DEBOUNCE + 0.1, _flush)
        t.daemon = True
        t.start()
        _timer = t


def _flush():
    global _timer
    with _lock:
        items = list(_pending.items())
        _pending.clear()
        _timer = None
    for (project_dir, role_name), _ in items:
        _rescan_role(project_dir, role_name)


def _rescan_role(project_dir: str, role_name: str):
    """Re-extract one role and replace its DB records. Runs in the watcher thread."""
    try:
        from awx.main.models import Project
        from awx.customvars.models import RoleVariable, RoleTag, RoleHandler
        from awx.customvars.extract import extract_role, extract_role_tags, extract_role_handlers

        # Find the project whose on-disk path matches project_dir
        real_project_dir = os.path.realpath(project_dir)
        project = None
        for p in Project.objects.filter(local_path__isnull=False).exclude(local_path=''):
            try:
                lp = p.get_project_path(check_if_exists=False)
                if lp and os.path.realpath(lp) == real_project_dir:
                    project = p
                    break
            except Exception:
                continue

        if project is None:
            log.debug('watcher: no project found for dir %s', project_dir)
            return

        project_id = project.pk
        role_dir = pathlib.Path(project_dir) / 'roles' / role_name

        if not role_dir.is_dir():
            # Role was deleted externally — remove DB records
            RoleVariable.objects.filter(project_id=project_id, role_name=role_name).delete()
            RoleTag.objects.filter(project_id=project_id, role_name=role_name).delete()
            RoleHandler.objects.filter(project_id=project_id, role_name=role_name).delete()
            log.info('watcher: role removed, cleared DB entries: project=%s role=%s', project_id, role_name)
            return

        revision = _git_revision(project_dir)

        vars_data = extract_role(role_dir, project_id, revision)
        tags_data = extract_role_tags(role_dir)
        handlers_data = extract_role_handlers(role_dir)

        RoleVariable.objects.filter(project_id=project_id, role_name=role_name).delete()
        if vars_data:
            RoleVariable.objects.bulk_create([RoleVariable(**v) for v in vars_data])

        RoleTag.objects.filter(project_id=project_id, role_name=role_name).delete()
        if tags_data:
            RoleTag.objects.bulk_create([
                RoleTag(
                    project_id=project_id,
                    role_name=role_name,
                    tag_name=tag,
                    task_count=count,
                    scanned_revision=revision,
                )
                for tag, count in tags_data.items()
            ])

        RoleHandler.objects.filter(project_id=project_id, role_name=role_name).delete()
        if handlers_data:
            RoleHandler.objects.bulk_create([
                RoleHandler(
                    project_id=project_id,
                    role_name=role_name,
                    scanned_revision=revision,
                    **h,
                )
                for h in handlers_data
            ])

        log.info(
            'watcher: re-scanned project=%s role=%s → %d vars, %d tags, %d handlers',
            project_id, role_name, len(vars_data), len(tags_data), len(handlers_data),
        )

    except Exception as exc:
        log.warning('watcher: error re-scanning project_dir=%s role=%s: %s', project_dir, role_name, exc)


def _git_revision(project_dir: str) -> str:
    try:
        r = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=project_dir, capture_output=True, timeout=5, text=True,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return 'watcher'


class _Handler:
    """Minimal watchdog-compatible event handler."""

    def dispatch(self, event):
        pass  # unused — we use on_* directly

    def on_modified(self, event):
        self._check(event.src_path)

    def on_created(self, event):
        self._check(event.src_path)

    def on_moved(self, event):
        # dest_path is the new location after the move
        self._check(getattr(event, 'dest_path', '') or event.src_path)

    def _check(self, path: str):
        if not path:
            return
        m = _ROLE_VAR_RE.match(path)
        if not m:
            return
        project_dir, role_name = m.group(1), m.group(2)
        log.debug('watcher: change detected role=%s in %s', role_name, project_dir)
        _debounce(project_dir, role_name)


def start_watcher():
    """Start the watchdog Observer daemon. Called from CustomVarsConfig.ready()."""
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError as exc:
        log.warning('file-watcher disabled: watchdog not installed (%s). '
                    'Add watchdog to the Dockerfile.', exc)
        return

    from django.conf import settings
    watch_path = getattr(settings, 'PROJECTS_ROOT', '/var/lib/awx/projects')

    if not os.path.isdir(watch_path):
        log.warning('file-watcher: watch path does not exist: %s', watch_path)
        return

    # Wrap our handler so watchdog dispatches to it properly
    class _WatchdogBridge(FileSystemEventHandler):
        def __init__(self, inner):
            super().__init__()
            self._inner = inner

        def on_modified(self, event):
            if not event.is_directory:
                self._inner.on_modified(event)

        def on_created(self, event):
            if not event.is_directory:
                self._inner.on_created(event)

        def on_moved(self, event):
            if not event.is_directory:
                self._inner.on_moved(event)

    observer = Observer()
    observer.schedule(_WatchdogBridge(_Handler()), watch_path, recursive=True)
    observer.daemon = True
    observer.start()
    log.info('file-watcher started, watching %s', watch_path)
