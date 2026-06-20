# awx-ng: management command to run the project filesystem watcher standalone.
# Usage: python manage.py watch_projects
# Normally started automatically via AWX_NG_WATCH_PROJECTS=true in awx_task.
import time

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Watch project directories for external file changes and re-extract role variables.'

    def handle(self, *args, **options):
        from awx.customvars.file_watcher import start_watcher
        start_watcher()
        self.stdout.write('file-watcher running — Ctrl+C to stop')
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
