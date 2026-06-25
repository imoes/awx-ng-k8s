from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0009_drop_ssh_user'),
    ]

    operations = [
        migrations.AddField(
            model_name='executionnodelocation',
            name='environment',
            field=models.TextField(blank=True),
        ),
    ]
