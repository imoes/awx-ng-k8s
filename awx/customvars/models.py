"""
awx-ng Custom Models

Drei Bereiche:
  1. Rollen-Variablen (extraction cache)
  2. Locations (Foreman-style, NetBox-reconcileable)
  3. Proxy-Site-Zuordnung (Execution Nodes ↔ Locations)
"""

import uuid
from django.db import models


# ── 1. Rollen-Variablen-Extraktion ───────────────────────────────────────────

class RoleScan(models.Model):
    """Audit-Eintrag pro Project-Sync-Lauf."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project_id = models.IntegerField(db_index=True)
    scanned_at = models.DateTimeField(auto_now_add=True, db_index=True)
    revision = models.CharField(max_length=40, blank=True)
    roles_found = models.IntegerField(default=0)
    vars_extracted = models.IntegerField(default=0)
    tags_extracted = models.IntegerField(default=0)
    handlers_extracted = models.IntegerField(default=0)
    errors = models.JSONField(default=list)

    class Meta:
        ordering = ["-scanned_at"]
        verbose_name = "Role Scan"

    def __str__(self):
        return f"RoleScan project={self.project_id} rev={self.revision[:8]}"


class RoleVariable(models.Model):
    """
    Ein extrahierter Top-Level-Key aus roles/<name>/defaults|vars/main.yml.

    Granularität = Top-Level-Key (nicht pro Leaf), damit system.users.* nicht
    in tausende Zeilen explodiert und der Round-Trip zum YAML-File klar bleibt.
    """
    SOURCE_DEFAULTS = "defaults"
    SOURCE_VARS = "vars"
    SOURCE_CHOICES = [
        (SOURCE_DEFAULTS, "defaults/main.yml"),
        (SOURCE_VARS, "vars/main.yml"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project_id = models.IntegerField(db_index=True)
    role_name = models.CharField(max_length=255, db_index=True)
    var_name = models.CharField(max_length=255, db_index=True)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES)
    value_type = models.CharField(max_length=20)  # str|int|bool|dict|list|null|unsafe|jinja
    default_value = models.JSONField(null=True, blank=True)
    schema_hint = models.JSONField(null=True, blank=True)   # für UI-Formular-Rendering
    raw_yaml = models.TextField(blank=True)                 # Original-YAML-Block für Escape-Hatch
    has_jinja = models.BooleanField(default=False)          # enthält {{ }} — Vorsicht beim Editieren
    comment = models.TextField(blank=True)                  # führender Kommentarblock
    scanned_revision = models.CharField(max_length=40, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("project_id", "role_name", "var_name", "source")]
        ordering = ["role_name", "var_name"]
        verbose_name = "Role Variable"

    def __str__(self):
        return f"{self.role_name}.{self.var_name} ({self.source})"


# Hinweis: Es gibt KEINE separate Host-Rollen-Variablen-Tabelle mehr.
# Rollen-Variablen eines Hosts leben in den nativen Host.variables (host_vars) —
# einzige Quelle der Wahrheit, konsistent mit Ansible und der Variables-Ansicht.
# Der Rollen-Variablen-Tab berechnet Defaults aus RoleVariable und zeigt als
# 'überschrieben', was in host.variables gesetzt ist.


class RoleHandler(models.Model):
    """
    Ein Handler aus handlers/main.yml einer Rolle.
    name = der in notify: referenzierte Name.
    listen_targets = optionale aliases (listen: [...]).
    module = verwendetes Ansible-Modul (z.B. ansible.builtin.systemd).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project_id = models.IntegerField(db_index=True)
    role_name = models.CharField(max_length=255, db_index=True)
    handler_name = models.CharField(max_length=255)
    module = models.CharField(max_length=255, blank=True)
    listen_targets = models.JSONField(default=list)
    scanned_revision = models.CharField(max_length=40, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("project_id", "role_name", "handler_name")]
        ordering = ["role_name", "handler_name"]
        verbose_name = "Role Handler"

    def __str__(self):
        return f"{self.role_name} → {self.handler_name}"


class RoleTag(models.Model):
    """
    Ein Tag der in tasks/ einer Rolle verwendet wird.
    task_count = Anzahl der Tasks/Blocks die diesen Tag tragen.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project_id = models.IntegerField(db_index=True)
    role_name = models.CharField(max_length=255, db_index=True)
    tag_name = models.CharField(max_length=255, db_index=True)
    task_count = models.IntegerField(default=0)
    scanned_revision = models.CharField(max_length=40, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("project_id", "role_name", "tag_name")]
        ordering = ["role_name", "tag_name"]
        verbose_name = "Role Tag"

    def __str__(self):
        return f"{self.role_name}:{self.tag_name} ({self.task_count}x)"


# ── 2. Locations (Foreman-Stil) ──────────────────────────────────────────────

class Location(models.Model):
    """
    Physischer Standort (entspricht NetBox Site).
    Lokal verwaltbar, aber mit NetBox reconcilierbar.
    """
    SOURCE_LOCAL = "local"
    SOURCE_NETBOX = "netbox"
    SOURCE_RECONCILED = "reconciled"
    SOURCE_CHOICES = [
        (SOURCE_LOCAL, "Lokal angelegt"),
        (SOURCE_NETBOX, "Aus NetBox importiert"),
        (SOURCE_RECONCILED, "Lokal + NetBox abgeglichen"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True, db_index=True)
    description = models.TextField(blank=True)
    netbox_site_id = models.IntegerField(null=True, blank=True, db_index=True)
    netbox_site_slug = models.CharField(max_length=100, blank=True)
    source = models.CharField(max_length=15, choices=SOURCE_CHOICES, default=SOURCE_LOCAL)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Location"

    def __str__(self):
        return self.name


# ── 3. Proxy ↔ Location-Zuordnung ────────────────────────────────────────────

class ExecutionNodeLocation(models.Model):
    """
    Zuordnung eines AWX Execution Node (receptor-node-id) zu einer Location/Site,
    inkl. site-spezifischer Ansible-Verbindungsparameter.

    Ein Runner pro Site kann eigene Defaults haben:
      - ssh_credential_id: Referenz auf eine AWX Machine-Credential (SSH-Key,
                           nutzt den nativen AWX-Keystore — kein Klartext hier).
                           Wird beim Launch injiziert, wenn das Job Template
                           keine eigene Machine-Credential hat (Template gewinnt).
      - ansible_cfg     : roher ansible.cfg-Inhalt, der für Jobs dieser Site
                           verwendet wird (z.B. eigener known_hosts, Forks, Timeouts)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # AWX Instance hostname (entspricht Receptor-Node-ID)
    instance_hostname = models.CharField(max_length=255, unique=True, db_index=True)
    location = models.ForeignKey(
        Location, on_delete=models.SET_NULL, null=True, blank=True, related_name="execution_nodes"
    )
    # ── Site-spezifische Ansible-Verbindungsparameter ──────────────────────
    ssh_credential_id = models.IntegerField(null=True, blank=True)  # AWX Credential pk (Machine/SSH)
    ansible_cfg = models.TextField(blank=True)                       # roher ansible.cfg-Inhalt
    environment = models.TextField(blank=True)                       # KEY=VALUE per line, injected into job env
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Execution Node Location"

    def __str__(self):
        loc = self.location.name if self.location else "unassigned"
        return f"{self.instance_hostname} → {loc}"
