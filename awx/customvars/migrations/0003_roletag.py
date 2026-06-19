from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("customvars", "0002_rolevariable_source_unique"),
    ]

    operations = [
        migrations.AddField(
            model_name="rolescan",
            name="tags_extracted",
            field=models.IntegerField(default=0),
        ),
        migrations.CreateModel(
            name="RoleTag",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("project_id", models.IntegerField(db_index=True)),
                ("role_name", models.CharField(db_index=True, max_length=255)),
                ("tag_name", models.CharField(db_index=True, max_length=255)),
                ("task_count", models.IntegerField(default=0)),
                ("scanned_revision", models.CharField(blank=True, max_length=40)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Role Tag",
                "ordering": ["role_name", "tag_name"],
            },
        ),
        migrations.AddConstraint(
            model_name="roletag",
            constraint=models.UniqueConstraint(
                fields=["project_id", "role_name", "tag_name"],
                name="uq_roletag_project_role_tag",
            ),
        ),
    ]
