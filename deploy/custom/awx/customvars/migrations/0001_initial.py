"""
awx.customvars initial migration
Creates: role_scans, role_variables, locations, subnets, execution_node_locations
"""
import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True
    dependencies = []

    operations = [
        # ── RoleScan ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name="RoleScan",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("project_id", models.IntegerField(db_index=True)),
                ("scanned_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("revision", models.CharField(blank=True, max_length=40)),
                ("roles_found", models.IntegerField(default=0)),
                ("vars_extracted", models.IntegerField(default=0)),
                ("errors", models.JSONField(default=list)),
            ],
            options={"ordering": ["-scanned_at"], "verbose_name": "Role Scan"},
        ),
        # ── RoleVariable ──────────────────────────────────────────────────────
        migrations.CreateModel(
            name="RoleVariable",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("project_id", models.IntegerField(db_index=True)),
                ("role_name", models.CharField(db_index=True, max_length=255)),
                ("var_name", models.CharField(db_index=True, max_length=255)),
                ("source", models.CharField(
                    choices=[("defaults", "defaults/main.yml"), ("vars", "vars/main.yml")],
                    max_length=10,
                )),
                ("value_type", models.CharField(max_length=20)),
                ("default_value", models.JSONField(blank=True, null=True)),
                ("schema_hint", models.JSONField(blank=True, null=True)),
                ("raw_yaml", models.TextField(blank=True)),
                ("has_jinja", models.BooleanField(default=False)),
                ("comment", models.TextField(blank=True)),
                ("scanned_revision", models.CharField(blank=True, max_length=40)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["role_name", "var_name"], "verbose_name": "Role Variable"},
        ),
        migrations.AddConstraint(
            model_name="rolevariable",
            constraint=models.UniqueConstraint(
                fields=["project_id", "role_name", "var_name"],
                name="uq_rolevariable_project_role_var",
            ),
        ),
        # ── Location ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name="Location",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(db_index=True, max_length=255, unique=True)),
                ("description", models.TextField(blank=True)),
                ("netbox_site_id", models.IntegerField(blank=True, db_index=True, null=True)),
                ("netbox_site_slug", models.CharField(blank=True, max_length=100)),
                ("source", models.CharField(
                    choices=[("local", "Lokal angelegt"), ("netbox", "Aus NetBox importiert"), ("reconciled", "Lokal + NetBox abgeglichen")],
                    default="local",
                    max_length=15,
                )),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name"], "verbose_name": "Location"},
        ),
        # ── Subnet ────────────────────────────────────────────────────────────
        migrations.CreateModel(
            name="Subnet",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("location", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="subnets",
                    to="customvars.location",
                )),
                ("cidr", models.CharField(max_length=64)),
                ("vlan", models.IntegerField(blank=True, null=True)),
                ("gateway", models.CharField(blank=True, max_length=64)),
                ("netbox_prefix_id", models.IntegerField(blank=True, db_index=True, null=True)),
                ("source", models.CharField(default="local", max_length=15)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["cidr"], "verbose_name": "Subnet"},
        ),
        migrations.AddConstraint(
            model_name="subnet",
            constraint=models.UniqueConstraint(
                fields=["location", "cidr"],
                name="uq_subnet_location_cidr",
            ),
        ),
        # ── ExecutionNodeLocation ─────────────────────────────────────────────
        migrations.CreateModel(
            name="ExecutionNodeLocation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("instance_hostname", models.CharField(db_index=True, max_length=255, unique=True)),
                ("location", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="execution_nodes",
                    to="customvars.location",
                )),
                ("description", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"verbose_name": "Execution Node Location"},
        ),
    ]
