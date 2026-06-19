from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("customvars", "0005_hostrolevariable_runner_fields"),
    ]

    operations = [
        # Rollen-Variablen eines Hosts leben jetzt in den nativen host.variables.
        # Die parallele Override-Tabelle wird entfernt.
        migrations.DeleteModel(name="HostRoleVariable"),
    ]
