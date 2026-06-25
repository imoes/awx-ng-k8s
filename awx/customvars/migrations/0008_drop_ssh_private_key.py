from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('customvars', '0007_drop_subnet_add_ssh_private_key'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='executionnodelocation',
            name='ssh_private_key',
        ),
    ]
