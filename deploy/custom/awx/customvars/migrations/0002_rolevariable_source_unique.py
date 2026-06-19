"""
Erweitert den Unique-Constraint auf RoleVariable um die `source`-Spalte.

Hintergrund: Eine Rolle kann dieselbe Variable sowohl in defaults/main.yml
als auch in vars/main.yml definieren. Ohne `source` im Constraint würde
bulk_create bei solchen Rollen fehlschlagen.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("customvars", "0001_initial"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="rolevariable",
            name="uq_rolevariable_project_role_var",
        ),
        migrations.AddConstraint(
            model_name="rolevariable",
            constraint=models.UniqueConstraint(
                fields=["project_id", "role_name", "var_name", "source"],
                name="uq_rolevariable_project_role_var_source",
            ),
        ),
    ]
