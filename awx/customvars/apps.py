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

        from django.db.models.signals import post_save
        post_save.connect(_on_job_created, sender='main.Job', dispatch_uid='customvars_runner_cred_inject')


def _on_job_created(sender, instance, created, **kwargs):
    if not created:
        return
    job_pk = instance.pk
    from django.db import transaction
    transaction.on_commit(lambda: _deferred_inject(job_pk))


def _deferred_inject(job_pk):
    try:
        from awx.customvars.api import inject_runner_credential_for_job
        inject_runner_credential_for_job(job_pk)
    except Exception:
        import logging
        logging.getLogger('awx.customvars.apps').exception(
            'deferred runner credential injection failed for job %s', job_pk
        )
