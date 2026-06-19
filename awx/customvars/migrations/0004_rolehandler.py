from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("customvars", "0003_roletag"),
    ]

    operations = [
        migrations.AddField(
            model_name="rolescan",
            name="handlers_extracted",
            field=models.IntegerField(default=0),
        ),
        migrations.CreateModel(
            name="RoleHandler",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("project_id", models.IntegerField(db_index=True)),
                ("role_name", models.CharField(db_index=True, max_length=255)),
                ("handler_name", models.CharField(max_length=255)),
                ("module", models.CharField(blank=True, max_length=255)),
                ("listen_targets", models.JSONField(default=list)),
                ("scanned_revision", models.CharField(blank=True, max_length=40)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Role Handler",
                "ordering": ["role_name", "handler_name"],
            },
        ),
        migrations.AddConstraint(
            model_name="rolehandler",
            constraint=models.UniqueConstraint(
                fields=["project_id", "role_name", "handler_name"],
                name="uq_rolehandler_project_role_name",
            ),
        ),
    ]
