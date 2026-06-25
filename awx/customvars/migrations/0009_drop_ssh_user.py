from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0008_drop_ssh_private_key'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='executionnodelocation',
            name='ssh_user',
        ),
    ]
