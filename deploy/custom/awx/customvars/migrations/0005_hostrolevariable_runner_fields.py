from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("customvars", "0004_rolehandler"),
    ]

    operations = [
        migrations.CreateModel(
            name="HostRoleVariable",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("host_id", models.IntegerField(db_index=True)),
                ("project_id", models.IntegerField(db_index=True)),
                ("role_name", models.CharField(db_index=True, max_length=255)),
                ("var_name", models.CharField(db_index=True, max_length=255)),
                ("source", models.CharField(blank=True, max_length=10)),
                ("value", models.JSONField(blank=True, null=True)),
                ("default_value", models.JSONField(blank=True, null=True)),
                ("value_type", models.CharField(blank=True, max_length=20)),
                ("is_overridden", models.BooleanField(default=False)),
                ("has_jinja", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Host Role Variable",
                "ordering": ["role_name", "var_name"],
            },
        ),
        migrations.AddConstraint(
            model_name="hostrolevariable",
            constraint=models.UniqueConstraint(
                fields=["host_id", "role_name", "var_name"],
                name="uq_hostrolevar_host_role_var",
            ),
        ),
        migrations.AddField(
            model_name="executionnodelocation",
            name="ssh_user",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="executionnodelocation",
            name="ssh_credential_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="executionnodelocation",
            name="ansible_cfg",
            field=models.TextField(blank=True),
        ),
    ]
