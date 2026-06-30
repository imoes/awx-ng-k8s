import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0011_location_connection_settings'),
    ]

    operations = [
        migrations.CreateModel(
            name='AnsibleVault',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(db_index=True, max_length=100, unique=True)),
                ('description', models.TextField(blank=True)),
                ('vault_password', models.CharField(max_length=64)),
                ('awx_credential_id', models.IntegerField(blank=True, null=True)),
                ('variables', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Ansible Vault',
                'ordering': ['name'],
            },
        ),
    ]
