# DB-authoritative JSON-IR document store (see docstore.py).
# Hand-trimmed from makemigrations to create ONLY ProjectDocument — the auto version also churned
# the pre-existing Role* unique constraints (model/migration drift unrelated to this feature).
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0014_mcp_authoring_embeddings'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectDocument',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('project_id', models.IntegerField(db_index=True)),
                ('path', models.CharField(db_index=True, max_length=1024)),
                ('kind', models.CharField(choices=[('structured', 'structured (JSON-IR)'), ('raw', 'raw text')], default='structured', max_length=16)),
                ('fmt', models.CharField(default='yaml', max_length=16)),
                ('doc', models.JSONField(blank=True, null=True)),
                ('raw', models.TextField(blank=True, default='')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddIndex(
            model_name='projectdocument',
            index=models.Index(fields=['project_id', 'kind'], name='customvars__project_d75bd4_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='projectdocument',
            unique_together={('project_id', 'path')},
        ),
    ]
