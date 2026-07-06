# MCP prose-authoring: semantic-search embeddings + generation cache.
# Hand-trimmed from makemigrations output to create ONLY the two new models — the
# auto-generated version also churned the existing Role* unique constraints (pre-existing
# model/migration drift unrelated to this feature), which we deliberately leave untouched.
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0013_ansiblevault_linked_templates'),
    ]

    operations = [
        migrations.CreateModel(
            name='AuthoringCacheEntry',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('source_hash', models.CharField(db_index=True, max_length=64, unique=True)),
                ('prose', models.TextField()),
                ('prompt_embedding', models.JSONField(blank=True, null=True)),
                ('artifact_json', models.JSONField()),
                ('hits', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='EmbeddedBlock',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[('module', 'module'), ('role', 'role'), ('playbook', 'playbook')], db_index=True, max_length=16)),
                ('project_id', models.IntegerField(db_index=True, default=0)),
                ('ref', models.CharField(db_index=True, max_length=512)),
                ('text', models.TextField()),
                ('embedding', models.JSONField()),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddIndex(
            model_name='embeddedblock',
            index=models.Index(fields=['kind', 'project_id'], name='customvars__kind_9fee16_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='embeddedblock',
            unique_together={('kind', 'project_id', 'ref')},
        ),
    ]
