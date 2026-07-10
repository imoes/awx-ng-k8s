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
    # ── Site-weite Ansible-Verbindungs-Defaults ─────────────────────────────
    # Gelten für alle Runner dieser Site (= Instance Group). Ein einzelner Runner
    # kann sie per ExecutionNodeLocation überschreiben (Runner-Override gewinnt).
    ssh_credential_id = models.IntegerField(null=True, blank=True)  # AWX Credential pk (Machine/SSH)
    ansible_cfg = models.TextField(blank=True)                       # roher ansible.cfg-Inhalt
    environment = models.TextField(blank=True)                       # KEY=VALUE per line, injected into job env
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Location"

    def __str__(self):
        return self.name


# ── 3. Ansible Vault Store ───────────────────────────────────────────────────

class AnsibleVault(models.Model):
    """
    Named ansible-vault store.

    Variables are kept plaintext in DB; the Generate endpoint encrypts them into
    a proper vault file using the auto-generated vault_password. The same password
    is stored in an AWX Credential (kind=vault) that is auto-injected at job start.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, db_index=True)  # = vault-id in ansible
    description = models.TextField(blank=True)
    vault_password = models.CharField(max_length=64)   # auto-generated, stored plaintext
    awx_credential_id = models.IntegerField(null=True, blank=True)
    variables = models.JSONField(default=dict)                # {key: value, ...} plaintext
    linked_job_template_ids = models.JSONField(default=list)  # [job_template_id, ...]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Ansible Vault'

    def __str__(self):
        return self.name


# ── 4. Proxy ↔ Location-Zuordnung ────────────────────────────────────────────

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


# ── 4. MCP prose-authoring: semantic retrieval + generation cache ─────────────
# Embeddings are stored as a plain JSON list[float] (bge-m3, 1024-dim) and cosine
# similarity is computed in Python — NOT pgvector. At this scale (dozens of modules +
# a few hundred role/playbook/cache rows) brute-force cosine is <1ms and needs no DB
# extension / image change (see plan). Transparently upgradable to pgvector later.

class EmbeddedBlock(models.Model):
    """One embedded building block (a module, a role, or a playbook) for semantic search.

    Populated by `awx-manage mcp_reindex`. `ref` identifies the block within its kind
    (module short_name, "<project_id>:<role_name>", or a playbook path). Modules are
    project-agnostic (project_id=0); roles/playbooks are per-project.
    """
    KIND_MODULE = "module"
    KIND_ROLE = "role"
    KIND_PLAYBOOK = "playbook"
    KIND_CHOICES = [(KIND_MODULE, "module"), (KIND_ROLE, "role"), (KIND_PLAYBOOK, "playbook")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, db_index=True)
    project_id = models.IntegerField(db_index=True, default=0)  # 0 = project-agnostic (modules)
    ref = models.CharField(max_length=512, db_index=True)       # short_name / role / playbook path
    text = models.TextField()                                   # the text that was embedded
    embedding = models.JSONField()                              # list[float], bge-m3 (1024)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("kind", "project_id", "ref")]
        indexes = [models.Index(fields=["kind", "project_id"])]

    def __str__(self):
        return f"{self.kind}:{self.ref}"


class AuthoringCacheEntry(models.Model):
    """A previously-produced, validated authoring artifact keyed by the prose request.

    Exact reuse via `source_hash` (sha256 of the normalized prose); fuzzy reuse via cosine
    over `prompt_embedding` (≥ threshold) so a near-duplicate request returns the stored
    playbook/plan with zero LLM tokens.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_hash = models.CharField(max_length=64, unique=True, db_index=True)
    prose = models.TextField()
    prompt_embedding = models.JSONField(null=True, blank=True)  # list[float] or null
    artifact_json = models.JSONField()                          # the produced artifact
    hits = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"cache:{self.source_hash[:12]} (hits={self.hits})"


# ── 5. JSON-IR document store (DB-authoritative project content) ───────────────
# Single source of truth for a project's EDITABLE content, to end the DB↔filesystem
# split-brain: editors (Monaco/Blockly/MCP) read & write THIS, never the on-disk checkout.
# The git working tree is a projection produced by export; import parses git back into here.
# Structured files (yaml/yml/json/nt) are stored as their parsed JSON-IR in `doc` (JSONField =
# Postgres jsonb); non-structured files (Jinja2 .j2, static files/) are stored verbatim in `raw`
# so the DB is authoritative for the WHOLE project, not just the structured parts.

class ProjectDocument(models.Model):
    STRUCTURED = "structured"
    RAW = "raw"
    KIND_CHOICES = [(STRUCTURED, "structured (JSON-IR)"), (RAW, "raw text")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project_id = models.IntegerField(db_index=True)
    path = models.CharField(max_length=1024, db_index=True)  # repo-relative, e.g. roles/x/tasks/main.yml
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=STRUCTURED)
    fmt = models.CharField(max_length=16, default="yaml")     # on-disk serialization for export (yaml/json/nt)
    doc = models.JSONField(null=True, blank=True)             # JSON-IR (structured); jsonb on Postgres
    raw = models.TextField(blank=True, default="")           # verbatim text (raw kind)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("project_id", "path")]
        indexes = [models.Index(fields=["project_id", "kind"])]

    def __str__(self):
        return f"proj{self.project_id}:{self.path} ({self.kind})"
