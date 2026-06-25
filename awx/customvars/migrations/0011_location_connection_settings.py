from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0010_executionnodelocation_environment'),
    ]

    operations = [
        migrations.AddField(
            model_name='location',
            name='ssh_credential_id',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='location',
            name='ansible_cfg',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='location',
            name='environment',
            field=models.TextField(blank=True),
        ),
    ]
