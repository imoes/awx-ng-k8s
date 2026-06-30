from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0012_ansiblevault'),
    ]

    operations = [
        migrations.AddField(
            model_name='ansiblevault',
            name='linked_job_template_ids',
            field=models.JSONField(default=list),
        ),
    ]
