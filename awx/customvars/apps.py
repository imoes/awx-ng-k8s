from django.apps import AppConfig


class CustomVarsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "awx.customvars"
    verbose_name = "AWX-NG Custom Variables & Locations"
