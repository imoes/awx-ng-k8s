# awx-ng: watches ansible project directories for external changes and
# re-extracts role variables / plays metadata when files are modified outside the editor.
#
# Two event classes:
#   - File inside roles/<name>/  → per-role rescan (vars, tags, handlers)
#   - .yml file elsewhere         → full scan_project_roles (playbooks/group_vars changed)
import logging
import os
import pathlib
import re
import subprocess
import threading
import time

log = logging.getLogger('awx.customvars.file_watcher')

_DEBOUNCE = 1.5  # seconds between last change and actual DB write

# _pending: (project_dir_str, role_name_or_sentinel) → deadline
# role_name_or_sentinel is the role name or '__all__' for a full project rescan
_pending: dict = {}
_lock = threading.Lock()
_timer = None

# Matches any file inside a role directory:  .../roles/<role_name>/...
_ROLE_FILE_RE = re.compile(r'(.*)/roles/([^/]+)/(.+)$')

# Base path of the watched PROJECTS_ROOT — set once by start_watcher()
_watch_root: str = ''


def _debounce(project_dir: str, role_key: str):
    """Schedule a (project_dir, role_key) rescan after the debounce window."""
    global _timer
    key = (project_dir, role_key)
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
    for (project_dir, role_key), _ in items:
        if role_key == '__all__':
            _rescan_project_full(project_dir)
        else:
            _rescan_role(project_dir, role_key)


# ── Per-role rescan ────────────────────────────────────────────────────────────

def _rescan_role(project_dir: str, role_name: str):
    """Re-extract vars, tags and handlers for one role and replace its DB records."""
    try:
        from awx.customvars.models import RoleVariable, RoleTag, RoleHandler
        from awx.customvars.extract import extract_role, extract_role_tags, extract_role_handlers

        project_id = _project_id_for_dir(project_dir)
        if project_id is None:
            return

        role_dir = pathlib.Path(project_dir) / 'roles' / role_name

        if not role_dir.is_dir():
            RoleVariable.objects.filter(project_id=project_id, role_name=role_name).delete()
            RoleTag.objects.filter(project_id=project_id, role_name=role_name).delete()
            RoleHandler.objects.filter(project_id=project_id, role_name=role_name).delete()
            log.info('watcher: role removed — cleared DB: project=%s role=%s', project_id, role_name)
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
            'watcher: role re-scanned: project=%s role=%s → %d vars, %d tags, %d handlers',
            project_id, role_name, len(vars_data), len(tags_data), len(handlers_data),
        )

    except Exception as exc:
        log.warning('watcher: error in _rescan_role project_dir=%s role=%s: %s',
                    project_dir, role_name, exc)


# ── Full project rescan (triggered by playbook changes) ───────────────────────

def _rescan_project_full(project_dir: str):
    """Re-scan all roles in a project. Used when a playbook or group_vars file changes."""
    try:
        from awx.customvars.extract import scan_project_roles

        project_id = _project_id_for_dir(project_dir)
        if project_id is None:
            return

        revision = _git_revision(project_dir)
        result = scan_project_roles(project_id, project_dir, revision)
        log.info(
            'watcher: full rescan triggered by playbook change: project=%s → %d roles, %d vars',
            project_id, result.get('roles_found', 0), result.get('vars_extracted', 0),
        )

    except Exception as exc:
        log.warning('watcher: error in _rescan_project_full project_dir=%s: %s', project_dir, exc)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _project_id_for_dir(project_dir: str) -> int | None:
    """Find the AWX project whose on-disk path matches project_dir."""
    try:
        from awx.main.models import Project
        real = os.path.realpath(project_dir)
        for p in Project.objects.filter(local_path__isnull=False).exclude(local_path=''):
            try:
                lp = p.get_project_path(check_if_exists=False)
                if lp and os.path.realpath(lp) == real:
                    return p.pk
            except Exception:
                continue
    except Exception as exc:
        log.debug('watcher: project lookup failed: %s', exc)
    return None


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


def _project_dir_from_path(abs_path: str) -> str | None:
    """
    Given an absolute file path that is under _watch_root, return the
    first-level subdirectory (= the project root on disk).
    """
    if not _watch_root:
        return None
    try:
        rel = pathlib.Path(abs_path).relative_to(_watch_root)
        return str(pathlib.Path(_watch_root) / rel.parts[0])
    except (ValueError, IndexError):
        return None


# ── Watchdog event handler ─────────────────────────────────────────────────────

class _Handler:
    def on_modified(self, event):
        self._check(event.src_path)

    def on_created(self, event):
        self._check(event.src_path)

    def on_moved(self, event):
        self._check(getattr(event, 'dest_path', '') or event.src_path)

    def _check(self, path: str):
        if not path:
            return

        # Is the file inside a role directory?
        m = _ROLE_FILE_RE.match(path)
        if m:
            project_dir, role_name = m.group(1), m.group(2)
            log.debug('watcher: role file changed: role=%s in %s', role_name, project_dir)
            _debounce(project_dir, role_name)
            return

        # Any other file (playbook, group_vars, host_vars, …) — full rescan
        project_dir = _project_dir_from_path(path)
        if project_dir and project_dir != path:
            log.debug('watcher: non-role file changed: %s — full rescan queued', path)
            _debounce(project_dir, '__all__')


# ── Public entry point ─────────────────────────────────────────────────────────

def start_watcher():
    """Start the watchdog Observer daemon. Called from CustomVarsConfig.ready()."""
    global _watch_root

    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError as exc:
        log.warning('file-watcher disabled: watchdog not installed (%s). '
                    'Add watchdog to Dockerfile.', exc)
        return

    from django.conf import settings
    watch_path = getattr(settings, 'PROJECTS_ROOT', '/var/lib/awx/projects')

    if not os.path.isdir(watch_path):
        log.warning('file-watcher: watch path does not exist: %s', watch_path)
        return

    _watch_root = os.path.realpath(watch_path)

    inner = _Handler()

    class _Bridge(FileSystemEventHandler):
        def on_modified(self, event):
            if not event.is_directory:
                inner.on_modified(event)

        def on_created(self, event):
            if not event.is_directory:
                inner.on_created(event)

        def on_moved(self, event):
            if not event.is_directory:
                inner.on_moved(event)

    observer = Observer()
    observer.schedule(_Bridge(), watch_path, recursive=True)
    observer.daemon = True
    observer.start()
    log.info('file-watcher started, watching %s', watch_path)
