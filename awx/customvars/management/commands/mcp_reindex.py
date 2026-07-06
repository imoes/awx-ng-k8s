"""
awx-manage mcp_reindex [project_id]

(Re)builds the EmbeddedBlock table used by the MCP prose-authoring semantic search
(search_modules / search_roles / search_playbooks). Embeds:
  - the ansible.builtin module catalog once (project-agnostic, project_id=0)
  - every role of each project (or just <project_id>) from the scanned RoleVariable/Tag/Handler
  - every playbook path of each project (from Project.playbook_files)

Uses the bge-m3 endpoint via awx.customvars.mcp.embeddings. If the endpoint is unreachable,
nothing is stored and the MCP search tools stay on their lexical fallback — so this command is
an optimization, never a hard dependency.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand

from awx.main.models import Project
from awx.customvars.models import RoleVariable, RoleTag, RoleHandler, EmbeddedBlock
from awx.customvars.mcp import embeddings

_CATALOG_PATH = Path(__file__).resolve().parents[2] / "mcp" / "data" / "moduleCatalog.generated.json"


def _module_texts():
    """Yield (ref, text) for every catalog module."""
    try:
        catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return
    for mod in catalog:
        params = " ".join(p.get("name", "") for p in mod.get("params", []))
        text = f"{mod.get('short_name')} {mod.get('short_description') or ''} params: {params}"
        yield mod.get("short_name"), text


def _role_texts(project_id):
    """Yield (ref, text) for every scanned role of a project."""
    names = set(RoleVariable.objects.filter(project_id=project_id).values_list("role_name", flat=True))
    names |= set(RoleTag.objects.filter(project_id=project_id).values_list("role_name", flat=True))
    names |= set(RoleHandler.objects.filter(project_id=project_id).values_list("role_name", flat=True))
    for rn in sorted(names):
        var_names = list(RoleVariable.objects.filter(project_id=project_id, role_name=rn).values_list("var_name", flat=True))
        tags = list(RoleTag.objects.filter(project_id=project_id, role_name=rn).values_list("tag_name", flat=True))
        text = f"role {rn} vars: {' '.join(var_names)} tags: {' '.join(tags)}"
        yield rn, text


def _playbook_texts(project):
    """Yield (ref, text) for every playbook path of a project."""
    for pb in (project.playbook_files or []):
        yield pb, f"playbook {pb}"


class Command(BaseCommand):
    help = "Rebuild MCP semantic-search embeddings (modules + roles + playbooks)."

    def add_arguments(self, parser):
        parser.add_argument("project_id", nargs="?", type=int, default=None,
                            help="Only reindex this project (roles+playbooks). Modules are always reindexed.")

    def _store(self, kind, project_id, items):
        """Embed (ref,text) items in batches and upsert into EmbeddedBlock. Returns count stored."""
        items = list(items)
        if not items:
            return 0
        stored = 0
        for i in range(0, len(items), 64):
            batch = items[i:i + 64]
            vecs = embeddings.embed([t for _, t in batch])
            if vecs is None:
                self.stderr.write(self.style.WARNING(
                    f"embedding endpoint unavailable — aborting {kind} reindex ({stored} stored)"))
                return stored
            for (ref, text), vec in zip(batch, vecs):
                EmbeddedBlock.objects.update_or_create(
                    kind=kind, project_id=project_id, ref=ref,
                    defaults={"text": text, "embedding": vec},
                )
                stored += 1
        return stored

    def handle(self, *args, **opts):
        n = self._store(EmbeddedBlock.KIND_MODULE, 0, _module_texts())
        self.stdout.write(self.style.SUCCESS(f"modules embedded: {n}"))

        if opts.get("project_id"):
            projects = Project.objects.filter(pk=opts["project_id"])
        else:
            projects = Project.objects.all()

        for proj in projects:
            r = self._store(EmbeddedBlock.KIND_ROLE, proj.id, _role_texts(proj.id))
            p = self._store(EmbeddedBlock.KIND_PLAYBOOK, proj.id, _playbook_texts(proj))
            self.stdout.write(self.style.SUCCESS(f"project {proj.id} ({proj.name}): roles {r}, playbooks {p}"))
