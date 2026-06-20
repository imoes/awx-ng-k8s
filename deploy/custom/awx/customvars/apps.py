import os

from django.apps import AppConfig


class CustomVarsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "awx.customvars"
    verbose_name = "AWX-NG Custom Variables & Locations"

    def ready(self):
        if os.environ.get('AWX_NG_WATCH_PROJECTS') == 'true':
            from .file_watcher import start_watcher
            start_watcher()
