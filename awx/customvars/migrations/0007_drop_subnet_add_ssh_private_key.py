from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0006_delete_hostrolevariable'),
    ]

    operations = [
        migrations.DeleteModel(name='Subnet'),
        migrations.AddField(
            model_name='executionnodelocation',
            name='ssh_private_key',
            field=models.TextField(blank=True, default='', help_text='Raw SSH private key (PEM) for this site'),
        ),
    ]
