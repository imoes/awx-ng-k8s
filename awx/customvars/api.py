"""
awx-ng Custom Variables REST API
=================================
Endpunkte:

  GET  /api/v2/projects/{id}/role_variables/             — extrahierte Rollen-Vars
  GET  /api/v2/projects/{id}/role_variables/scan/        — letzter Scan-Audit-Eintrag
  POST /api/v2/job_templates/{id}/generate_survey/       — Survey aus Rollen-Vars generieren
  GET  /api/v2/hosts/{id}/aggregated_variables/          — Host-Vars mit Herkunft
  POST /api/v2/hosts/{id}/set_root_password/             — rootpw sha512 setzen
  POST /api/v2/hosts/{id}/assign_roles/                  — host_roles schreiben
  POST /api/v2/tools/hash_password/                      — sha512-Hash erzeugen
  GET  /api/v2/locations/                                — Locations (Sites)
  POST /api/v2/locations/reconcile/                      — NetBox-Reconcile (Sites only)
"""

import json
import logging
import os
import re
import shutil

log = logging.getLogger('awx.customvars.api')

try:
    import crypt as _crypt
    def _sha512_crypt(password: str) -> str:
        return _crypt.crypt(password, _crypt.mksalt(_crypt.METHOD_SHA512))
except ImportError:
    # Python 3.13+ removed the crypt module; install passlib for sha512-crypt
    def _sha512_crypt(password: str) -> str:
        raise RuntimeError("sha512-crypt requires the 'crypt' module (Python ≤ 3.12) or 'passlib'")

from rest_framework import generics, serializers as drf_serializers, filters, status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from awx.api.permissions import IsSystemAdminOrAuditor
from awx.main.models import Project, JobTemplate, Host, Instance

from .models import (
    RoleVariable, RoleTag, RoleHandler, RoleScan,
    Location, ExecutionNodeLocation,
)


# ── Serializers ───────────────────────────────────────────────────────────────

class RoleVariableSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = RoleVariable
        fields = [
            'id', 'project_id', 'role_name', 'var_name', 'source',
            'value_type', 'default_value', 'schema_hint',
            'raw_yaml', 'has_jinja', 'comment',
            'scanned_revision', 'updated_at',
        ]


class RoleTagSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = RoleTag
        fields = [
            'id', 'project_id', 'role_name', 'tag_name',
            'task_count', 'scanned_revision', 'updated_at',
        ]


class ExecutionNodeLocationSerializer(drf_serializers.ModelSerializer):
    location_name = drf_serializers.CharField(source='location.name', read_only=True, default=None)

    class Meta:
        model = ExecutionNodeLocation
        fields = [
            'id', 'instance_hostname', 'location', 'location_name',
            'ssh_credential_id', 'ansible_cfg', 'environment',
            'description', 'created_at', 'updated_at',
        ]


class RoleHandlerSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = RoleHandler
        fields = [
            'id', 'project_id', 'role_name', 'handler_name',
            'module', 'listen_targets', 'scanned_revision', 'updated_at',
        ]


class RoleScanSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = RoleScan
        fields = [
            'id', 'project_id', 'scanned_at', 'revision',
            'roles_found', 'vars_extracted', 'tags_extracted', 'handlers_extracted', 'errors',
        ]


class LocationSerializer(drf_serializers.ModelSerializer):
    instance_group_id = drf_serializers.SerializerMethodField()

    def get_instance_group_id(self, obj):
        from awx.main.models import InstanceGroup
        ig = InstanceGroup.objects.filter(name=obj.name).first()
        return ig.id if ig else None

    class Meta:
        model = Location
        fields = [
            'id', 'name', 'description', 'instance_group_id',
            'netbox_site_id', 'netbox_site_slug',
            'source', 'last_synced_at',
            'created_at', 'updated_at',
        ]


# ── Views ─────────────────────────────────────────────────────────────────────

class ProjectRoleVariableListView(generics.ListAPIView):
    """
    GET /api/v2/projects/{project_id}/role_variables/

    Optionale Query-Parameter:
      ?role_name=<name>   — nur eine Rolle
      ?source=defaults    — nur defaults/main.yml
      ?search=<term>      — var_name contains
    """
    serializer_class = RoleVariableSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['var_name', 'comment']

    def get_queryset(self):
        project_id = self.kwargs['project_id']
        get_object_or_404(Project, pk=project_id)
        qs = RoleVariable.objects.filter(project_id=project_id)
        role_name = self.request.query_params.get('role_name')
        if role_name:
            qs = qs.filter(role_name=role_name)
        source = self.request.query_params.get('source')
        if source in ('defaults', 'vars'):
            qs = qs.filter(source=source)
        return qs


class ProjectRoleScanView(APIView):
    """
    GET /api/v2/projects/{project_id}/role_variables/scan/

    Liefert den letzten Scan-Audit-Eintrag für das Projekt.
    """
    def get(self, request, project_id, **kwargs):
        get_object_or_404(Project, pk=project_id)
        scan = RoleScan.objects.filter(project_id=project_id).first()
        if not scan:
            return Response({'detail': 'Noch kein Scan durchgeführt.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(RoleScanSerializer(scan).data)


class ProjectRoleScanTriggerView(APIView):
    """
    POST /api/v2/projects/{project_id}/role_variables/scan/

    Löst manuell einen Scan aus (nur für Admins / Debugging).
    """
    permission_classes = [IsSystemAdminOrAuditor]

    def post(self, request, project_id, **kwargs):
        project = get_object_or_404(Project, pk=project_id)
        project_path = project.get_project_path(check_if_exists=False)
        revision = project.scm_revision or ''
        from awx.customvars.extract import scan_project_roles
        result = scan_project_roles(project.pk, project_path, revision)
        return Response(result, status=status.HTTP_200_OK)


class ProjectRoleHandlerListView(generics.ListAPIView):
    """
    GET /api/v2/projects/{project_id}/role_handlers/

    Alle Handlers aus handlers/main.yml der Rollen eines Projekts.
    Filter: ?role_name=img_docker
    """
    serializer_class = RoleHandlerSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['role_name', 'handler_name', 'module']

    def get_queryset(self):
        project_id = self.kwargs['project_id']
        get_object_or_404(Project, pk=project_id)
        qs = RoleHandler.objects.filter(project_id=project_id)
        role_name = self.request.query_params.get('role_name')
        if role_name:
            qs = qs.filter(role_name=role_name)
        return qs


class ProjectRoleTagListView(generics.ListAPIView):
    """
    GET /api/v2/projects/{project_id}/role_tags/

    Alle extrahierten Tags eines Projekts.
    Filter: ?role_name=img_docker  ?tag_name=docker
    """
    serializer_class = RoleTagSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['role_name', 'tag_name']

    def get_queryset(self):
        project_id = self.kwargs['project_id']
        get_object_or_404(Project, pk=project_id)
        qs = RoleTag.objects.filter(project_id=project_id)
        role_name = self.request.query_params.get('role_name')
        tag_name = self.request.query_params.get('tag_name')
        if role_name:
            qs = qs.filter(role_name=role_name)
        if tag_name:
            qs = qs.filter(tag_name=tag_name)
        return qs


class ProjectRolesListView(APIView):
    """
    GET /api/v2/projects/{project_id}/roles/

    Listet alle Rollen eines Projekts:
    - Rollen auf Disk (roles/-Unterverzeichnisse)
    - Rollen in der DB (mit Variablen)
    - Variablen-Anzahl je Rolle
    - Letzter Scan-Status
    """

    def get(self, request, project_id, **kwargs):
        import pathlib
        from django.db.models import Count as _Count

        project = get_object_or_404(Project, pk=project_id)

        # DB-Rollen mit Variablen-Anzahl
        db_counts = dict(
            RoleVariable.objects.filter(project_id=project_id)
            .values('role_name')
            .annotate(c=_Count('id'))
            .values_list('role_name', 'c')
        )

        # Rollen auf Disk
        disk_roles: set = set()
        try:
            project_path = project.get_project_path(check_if_exists=False)
            roles_dir = pathlib.Path(project_path) / 'roles'
            if roles_dir.exists():
                disk_roles = {d.name for d in roles_dir.iterdir() if d.is_dir()}
        except Exception:
            pass

        # Letzter Scan
        last_scan = RoleScan.objects.filter(project_id=project_id).order_by('-id').first()

        all_names = sorted(disk_roles | set(db_counts.keys()))
        results = [
            {
                'role_name': r,
                'var_count': db_counts.get(r, 0),
                'on_disk': r in disk_roles,
                'has_vars': r in db_counts,
            }
            for r in all_names
        ]

        return Response({
            'count': len(results),
            'results': results,
            'last_scan': {
                'revision': last_scan.revision,
                'roles_found': last_scan.roles_found,
                'vars_extracted': last_scan.vars_extracted,
                'tags_extracted': last_scan.tags_extracted,
                'handlers_extracted': last_scan.handlers_extracted,
                'errors': last_scan.errors,
            } if last_scan else None,
        })


class LocationListView(generics.ListCreateAPIView):
    """GET/POST /api/v2/locations/"""
    serializer_class = LocationSerializer
    queryset = Location.objects.all()
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'description', 'netbox_site_slug']


class LocationDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/v2/locations/{id}/"""
    serializer_class = LocationSerializer
    queryset = Location.objects.all()


# ── Survey-Generierung ────────────────────────────────────────────────────────

# Mapping RoleVariable.value_type → AWX survey question type
_VALUE_TYPE_TO_SURVEY_TYPE = {
    'str': 'text',
    'int': 'integer',
    'float': 'float',
    'bool': 'multiplechoice',
    'dict': 'textarea',
    'list': 'textarea',
    'null': 'text',
    'unsafe': 'text',
    'vault': 'password',
}


def _role_var_to_survey_item(rv: RoleVariable) -> dict:
    """
    Wandelt einen RoleVariable-Datensatz in ein AWX-Survey-Spec-Item um.

    Regeln (aus AWX _validate_spec_data):
    - text/textarea/password/multiplechoice/multiselect default → str
    - integer default → int
    - float default → float (int auch erlaubt)
    - multiplechoice braucht choices (newline-getrennt)
    - password default wird nie gesetzt (vault-Inhalt ist verschlüsselt)
    """
    survey_type = _VALUE_TYPE_TO_SURVEY_TYPE.get(rv.value_type, 'text')
    val = rv.default_value

    item = {
        'type': survey_type,
        'question_name': rv.var_name,
        'question_description': rv.comment or f'[{rv.role_name}/{rv.source}]',
        'variable': rv.var_name,
        'required': False,
    }

    if rv.value_type == 'bool':
        item['choices'] = 'true\nfalse'
        if isinstance(val, bool):
            item['default'] = 'true' if val else 'false'
        else:
            item['default'] = ''

    elif rv.value_type == 'vault':
        item['default'] = ''

    elif rv.value_type in ('dict', 'list'):
        # JSON für dict/list: Ansible-Rollen verwenden to_nice_json / from_json.
        # host.variables bleibt YAML (dort schreiben wir yaml.dump).
        # Survey-Werte werden als extra_vars (String) übergeben → Ansible
        # braucht gültiges JSON wenn die Rolle combine()/from_json nutzt.
        if val is not None:
            try:
                item['default'] = json.dumps(val, ensure_ascii=False, indent=2)
            except (TypeError, ValueError):
                item['default'] = str(val)
        else:
            item['default'] = ''

    elif rv.value_type == 'int':
        item['default'] = int(val) if isinstance(val, (int, float)) else ''

    elif rv.value_type == 'float':
        item['default'] = float(val) if isinstance(val, (int, float)) else ''

    elif rv.value_type == 'null':
        item['default'] = ''

    else:
        # text, textarea, unsafe, str
        if val is None:
            item['default'] = ''
        elif isinstance(val, str):
            item['default'] = val
        else:
            item['default'] = str(val)

    return item


class GenerateSurveyFromRolesView(APIView):
    """
    POST /api/v2/job_templates/{pk}/generate_survey/

    Generiert Survey-Fragen aus extrahierten Rollen-Variablen und merged
    sie mit dem bestehenden survey_spec des Job Templates.

    Request-Body:
      {
        "role_names": ["img_docker", "img_system"],   ← Pflicht
        "project_id": 5,                               ← Pflicht
        "survey_name": "Optionaler Name",              ← optional
        "survey_description": "Beschreibung",          ← optional
        "replace": false                               ← true = komplett ersetzen
      }

    Verhalten bei merge (replace=false, Standard):
    - Bestehende Items bleiben erhalten (keyed by variable name)
    - Neue Items werden hinten angehängt
    - Variablen die bereits im Spec existieren werden übersprungen

    Response: das gespeicherte survey_spec-Dict + Zähler
    """

    def post(self, request, pk, **kwargs):
        jt = get_object_or_404(JobTemplate, pk=pk)
        if not request.user.can_access(JobTemplate, 'change', jt, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

        role_names = request.data.get('role_names')
        project_id = request.data.get('project_id')

        if not role_names or not isinstance(role_names, list):
            return Response({'error': "'role_names' muss eine nicht-leere Liste sein."}, status=status.HTTP_400_BAD_REQUEST)
        if not project_id:
            return Response({'error': "'project_id' ist Pflichtfeld."}, status=status.HTTP_400_BAD_REQUEST)

        survey_name = request.data.get('survey_name', f'Auto-Survey ({", ".join(role_names)})')
        survey_description = request.data.get('survey_description', 'Generiert aus Rollen-Variablen von awx-ng')
        replace = bool(request.data.get('replace', False))

        # Alle RoleVariables der gewählten Rollen laden (geordnet: Rolle → defaults vor vars → var_name)
        role_vars = (
            RoleVariable.objects
            .filter(project_id=project_id, role_name__in=role_names)
            .exclude(value_type='vault')         # Vault-Vars nie auto-in-Survey
            .order_by('role_name', 'source', 'var_name')
        )

        # Bestehenden Spec einlesen
        existing_spec = jt.survey_spec or {}
        existing_items = existing_spec.get('spec', [])

        if replace:
            existing_items = []

        # Pivot für schnellen Lookup ob Variable bereits vorhanden
        existing_vars = {item['variable'] for item in existing_items}

        new_items = []
        skipped = 0
        for rv in role_vars:
            if rv.var_name in existing_vars:
                skipped += 1
                continue
            existing_vars.add(rv.var_name)
            new_items.append(_role_var_to_survey_item(rv))

        if not existing_items and not new_items:
            return Response({'error': 'Keine Variablen gefunden für die angegebenen Rollen und project_id.'}, status=status.HTTP_404_NOT_FOUND)

        merged_spec = {
            'name': existing_spec.get('name', survey_name),
            'description': existing_spec.get('description', survey_description),
            'spec': existing_items + new_items,
        }

        # Speichern — AWX-Validierung intentionally NICHT nochmal aufgerufen,
        # da wir kein Password-Reencrypt-Handling brauchen und nur neue, einfache
        # Typen einfügen. AWX validiert beim nächsten GET/display_survey_spec ohnehin.
        jt.survey_spec = merged_spec
        jt.survey_enabled = True
        jt.save(update_fields=['survey_spec', 'survey_enabled'])

        return Response({
            'survey_spec': merged_spec,
            'added': len(new_items),
            'skipped_existing': skipped,
            'total_items': len(merged_spec['spec']),
        }, status=status.HTTP_200_OK)


# ── Phase 4: Per-Host aggregierte Variablen + rootpw + Rollen-Klick ──────────

def _deep_merge(base: dict, override: dict) -> dict:
    """
    Ansible hash_behaviour=merge: Dicts werden rekursiv gemerged,
    Skalare/Listen ersetzen. Gibt immer ein neues Dict zurück.
    """
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


class HostAggregatedVariablesView(APIView):
    """
    GET /api/v2/hosts/{pk}/aggregated_variables/

    Berechnet die effektiven Ansible-Variablen für einen Host nach
    Präzedenz-Reihenfolge (niedrig → hoch):
      1.  role_defaults  (aus RoleVariable, roles listed in host_roles)
      2.  group_vars     (alle Gruppen des Hosts, flach gemerged)
      3.  host_vars      (Host.variables_dict — enthält die Rollen-Overrides)

    Survey-Defaults werden separat als 'survey_defaults' ausgewiesen
    (sie werden als -e übergeben und überschreiben alles — nur zur Info).

    Response:
      {
        "effective": { "var": value, ... },
        "layers": {
          "var": [
            { "source": "role_default", "role": "img_system", "value": ... },
            { "source": "group_var",    "group": "webservers",  "value": ... },
            { "source": "host_var",                             "value": ... }
          ]
        },
        "survey_defaults": { "var": value, ... }
      }
    """

    def get(self, request, pk, **kwargs):
        host = get_object_or_404(Host, pk=pk)

        # Tracking: pro Variable alle Quell-Schichten
        layers: dict[str, list] = {}
        effective: dict = {}

        def _apply(source_vars: dict, source_info: dict):
            nonlocal effective
            for k, v in source_vars.items():
                if k not in layers:
                    layers[k] = []
                layers[k].append({**source_info, 'value': v})
            effective = _deep_merge(effective, source_vars)

        # 1. Role defaults (niedrigste Präzedenz)
        host_vars_dict = host.variables_dict or {}
        host_roles = host_vars_dict.get('host_roles', [])
        if isinstance(host_roles, str):
            host_roles = [r.strip() for r in host_roles.split(',') if r.strip()]

        if host_roles:
            rv_filter = {'role_name__in': host_roles, 'source': 'defaults'}
            project_id_param = request.query_params.get('project_id')
            if project_id_param:
                rv_filter['project_id'] = int(project_id_param)
            role_vars_qs = (
                RoleVariable.objects
                .filter(**rv_filter)
                .order_by('role_name', 'var_name')
            )
            role_defaults: dict = {}
            for rv in role_vars_qs:
                if rv.var_name not in role_defaults:
                    role_defaults[rv.var_name] = (rv.default_value, rv.role_name)
            for var_name, (val, role_name) in role_defaults.items():
                _apply({var_name: val}, {'source': 'role_default', 'role': role_name})

        # 2. Group vars (Elterngruppen zuerst, dann direkte Gruppen)
        all_groups = list(host.all_groups.order_by('name'))
        for grp in all_groups:
            gvars = grp.variables_dict or {}
            if gvars:
                _apply(gvars, {'source': 'group_var', 'group': grp.name})

        # 3. Host vars (höchste Präzedenz unter den normalen Schichten)
        if host_vars_dict:
            _apply(host_vars_dict, {'source': 'host_var'})

        # Survey defaults — separat, da sie als -e gesendet werden
        survey_defaults: dict = {}
        jt_pk = request.query_params.get('job_template_id')
        if jt_pk:
            try:
                jt = JobTemplate.objects.get(pk=jt_pk)
                if jt.survey_enabled and 'spec' in jt.survey_spec:
                    for item in jt.survey_spec['spec']:
                        if 'variable' in item and 'default' in item:
                            survey_defaults[item['variable']] = item['default']
            except JobTemplate.DoesNotExist:
                pass

        return Response({
            'host_id': host.pk,
            'host_name': host.name,
            'effective': effective,
            'layers': layers,
            'survey_defaults': survey_defaults,
        })


class HashPasswordView(APIView):
    """
    POST /api/v2/tools/hash_password/

    Body: {"password": "plaintext"}
    Response: {"hash": "$6$salt$..."}

    Das Plaintext-Passwort wird nie geloggt oder gespeichert.
    """

    def post(self, request, **kwargs):
        password = request.data.get('password', '')
        if not password or not isinstance(password, str):
            return Response({'error': "'password' ist Pflichtfeld (String)."}, status=status.HTTP_400_BAD_REQUEST)
        hashed = _sha512_crypt(password)
        return Response({'hash': hashed})


class HostSetRootPasswordView(APIView):
    """
    POST /api/v2/hosts/{pk}/set_root_password/

    Body: {"password": "plaintext", "var_name": "rootpw"}
    Hasht das Passwort (sha512) und schreibt es in Host.variables.
    Der Klartext wird nicht gespeichert.
    """

    def post(self, request, pk, **kwargs):
        host = get_object_or_404(Host, pk=pk)
        if not request.user.can_access(Host, 'change', host, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

        password = request.data.get('password', '')
        var_name = request.data.get('var_name', 'rootpw')
        if not password or not isinstance(password, str):
            return Response({'error': "'password' ist Pflichtfeld."}, status=status.HTTP_400_BAD_REQUEST)

        hashed = _sha512_crypt(password)
        hvars = host.variables_dict or {}
        hvars[var_name] = hashed

        import yaml as _yaml
        host.variables = _yaml.dump(hvars, default_flow_style=False, allow_unicode=True)
        host.save(update_fields=['variables'])

        return Response({'var_name': var_name, 'status': 'set', 'hash_prefix': hashed[:10] + '...'})


class HostCloneView(APIView):
    """
    POST /api/v2/hosts/{pk}/clone/

    Klont einen Host innerhalb desselben Inventars — ideal für standardisierte
    Hosts (z.B. Docker-Host mit /data1). Kopiert:
      - Host.variables (inkl. host_roles und aller Rollen-Variablen-Overrides)
      - optional die Gruppen-Mitgliedschaften (copy_groups, Default true)

    Body: {"name": "neuer-host", "copy_groups": true}
    """

    def post(self, request, pk, **kwargs):
        from awx.main.models import Inventory  # lokal, vermeidet Zirkularimport

        source = get_object_or_404(Host, pk=pk)
        new_name = (request.data.get('name') or '').strip()
        if not new_name:
            return Response({'error': "'name' ist Pflichtfeld."}, status=status.HTTP_400_BAD_REQUEST)

        # Berechtigung: Host im Ziel-Inventar anlegen dürfen
        if not request.user.can_access(
            Host, 'add', {'inventory': source.inventory_id, 'name': new_name}
        ):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

        if Host.objects.filter(inventory_id=source.inventory_id, name=new_name).exists():
            return Response(
                {'error': f"Host '{new_name}' existiert bereits in diesem Inventar."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        copy_groups = request.data.get('copy_groups', True)

        # 1. Host anlegen (Variablen + Stammdaten übernehmen)
        clone = Host.objects.create(
            name=new_name,
            inventory=source.inventory,
            description=source.description,
            enabled=source.enabled,
            variables=source.variables,
            created_by=request.user,
            modified_by=request.user,
        )

        # 2. Gruppen-Mitgliedschaften übernehmen
        if copy_groups:
            clone.groups.add(*source.groups.all())

        # Rollen-Variablen leben in host.variables (oben mitkopiert) — kein
        # separater Schritt nötig.
        return Response({
            'id': clone.pk,
            'name': clone.name,
            'inventory': clone.inventory_id,
            'cloned_from': source.pk,
            'groups_copied': clone.groups.count() if copy_groups else 0,
        }, status=status.HTTP_201_CREATED)


def _infer_project_id_for_roles(host, roles):
    """
    Ermittelt das Herkunfts-Projekt der Rollen für einen Host.
    1. SCM-Inventory-Source des Inventars mit source_project → dessen Projekt
    2. sonst: Projekt aus RoleVariable, das die meisten der gewünschten Rollen enthält
    """
    # 1. via Inventory-Source
    try:
        inv = host.inventory
        for src in inv.inventory_sources.all():
            pid = getattr(src, 'source_project_id', None)
            if pid:
                return pid
    except Exception:
        pass
    # 2. via RoleVariable-Treffer
    if roles:
        from django.db.models import Count
        match = (
            RoleVariable.objects
            .filter(role_name__in=roles)
            .values('project_id')
            .annotate(n=Count('role_name', distinct=True))
            .order_by('-n')
            .first()
        )
        if match:
            return match['project_id']
    return None


class HostAssignRolesView(APIView):
    """
    POST /api/v2/hosts/{pk}/assign_roles/

    Body: {"roles": ["img_docker", "img_system"]}

    Schreibt host_roles in die nativen Host.variables (site.yml liest das, und
    der Rollen-Variablen-Tab zeigt die Variablen dieser Rollen). Es werden KEINE
    Variablen vorab materialisiert — die Defaults kommen aus den Rollen, nur vom
    Nutzer geänderte Werte landen als host_vars in host.variables (Foreman-Stil).
    """

    def post(self, request, pk, **kwargs):
        host = get_object_or_404(Host, pk=pk)
        if not request.user.can_access(Host, 'change', host, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

        roles = request.data.get('roles', [])
        if not isinstance(roles, list):
            return Response({'error': "'roles' muss eine Liste sein."}, status=status.HTTP_400_BAD_REQUEST)

        import yaml as _yaml
        hvars = host.variables_dict or {}
        hvars['host_roles'] = roles
        host.variables = _yaml.dump(hvars, default_flow_style=False, allow_unicode=True, sort_keys=False)
        host.save(update_fields=['variables'])

        return Response({
            'host_id': host.pk,
            'host_name': host.name,
            'host_roles': roles,
        })


class HostRoleVariableListView(APIView):
    """
    GET /api/v2/hosts/{pk}/role_variables/

    Rollen-Variablen eines Hosts — berechnet aus den ZUGEWIESENEN Rollen
    (host_roles in host.variables) und den Rollen-Defaults (RoleVariable).
    Der EFFEKTIVE Wert kommt aus den nativen host.variables; ist die Variable
    dort gesetzt, gilt sie als 'überschrieben'. Einzige Quelle der Wahrheit ist
    damit host.variables — konsistent mit der Variables-Ansicht und Ansible.

    Query: ?project_id=8 (sonst aus Inventory-Source/Rollen abgeleitet)
           ?role_name=img_docker  ?overridden=true
    """
    def get(self, request, pk, **kwargs):
        host = get_object_or_404(Host, pk=pk)
        hvars = host.variables_dict or {}
        host_roles = hvars.get('host_roles', [])
        if isinstance(host_roles, str):
            host_roles = [r.strip() for r in host_roles.split(',') if r.strip()]

        project_id = request.query_params.get('project_id') or _infer_project_id_for_roles(host, host_roles)

        role_filter = request.query_params.get('role_name')
        only_overridden = request.query_params.get('overridden')

        results = []
        if project_id and host_roles:
            roles = [role_filter] if role_filter else host_roles
            rv_qs = (
                RoleVariable.objects
                .filter(project_id=project_id, role_name__in=roles)
                .order_by('role_name', 'var_name')
            )
            for rv in rv_qs:
                is_overridden = rv.var_name in hvars
                value = hvars[rv.var_name] if is_overridden else rv.default_value
                if only_overridden is not None:
                    want = only_overridden.lower() in ('1', 'true', 'yes')
                    if is_overridden != want:
                        continue
                results.append({
                    'host_id': host.pk,
                    'project_id': project_id,
                    'role_name': rv.role_name,
                    'var_name': rv.var_name,
                    'source': rv.source,
                    'value': value,
                    'default_value': rv.default_value,
                    'value_type': rv.value_type,
                    'is_overridden': is_overridden,
                    'has_jinja': rv.has_jinja,
                })
        return Response({
            'count': len(results),
            'results': results,
            'host_roles': host_roles,
            'project_id': project_id,
        })


class HostRoleVariableDetailView(APIView):
    """
    PATCH  /api/v2/hosts/{pk}/role_variables/{var_name}/  — Wert in host.variables setzen
           Body: {"value": <beliebiger Wert>}
    DELETE /api/v2/hosts/{pk}/role_variables/{var_name}/  — Variable aus host.variables
           entfernen → fällt auf den Rollen-Default zurück
    """
    def _get_host(self, request, pk):
        host = get_object_or_404(Host, pk=pk)
        if not request.user.can_access(Host, 'change', host, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        return host

    def _save(self, host, hvars):
        import yaml as _yaml
        host.variables = _yaml.dump(hvars, default_flow_style=False, allow_unicode=True, sort_keys=False)
        host.save(update_fields=['variables'])

    def patch(self, request, pk, var_name, **kwargs):
        host = self._get_host(request, pk)
        if 'value' not in request.data:
            return Response({'error': "Feld 'value' fehlt."}, status=status.HTTP_400_BAD_REQUEST)
        hvars = host.variables_dict or {}
        hvars[var_name] = request.data['value']
        self._save(host, hvars)
        return Response({'var_name': var_name, 'value': hvars[var_name], 'is_overridden': True})

    def delete(self, request, pk, var_name, **kwargs):
        host = self._get_host(request, pk)
        hvars = host.variables_dict or {}
        existed = var_name in hvars
        if existed:
            del hvars[var_name]
            self._save(host, hvars)
        return Response({'var_name': var_name, 'is_overridden': False, 'removed': existed})


# ─── Group variables (mirrors Host; single source of truth = group.variables) ───

class GroupAssignRolesView(APIView):
    """
    POST /api/v2/groups/{pk}/assign_roles/  — Body: {"roles": [...]}
    Sets host_roles in the native Group.variables (baseline for the group's members).
    """
    def post(self, request, pk, **kwargs):
        from awx.main.models import Group
        group = get_object_or_404(Group, pk=pk)
        if not request.user.can_access(Group, 'change', group, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        roles = request.data.get('roles', [])
        if not isinstance(roles, list):
            return Response({'error': "'roles' muss eine Liste sein."}, status=status.HTTP_400_BAD_REQUEST)
        import yaml as _yaml
        gvars = group.variables_dict or {}
        gvars['host_roles'] = roles
        group.variables = _yaml.dump(gvars, default_flow_style=False, allow_unicode=True, sort_keys=False)
        group.save(update_fields=['variables'])
        return Response({'group_id': group.pk, 'group_name': group.name, 'host_roles': roles})


class GroupRoleVariableListView(APIView):
    """
    GET /api/v2/groups/{pk}/role_variables/
    A group's role variables — from host_roles (group.variables) + RoleVariable defaults.
    The effective value / override comes from the native group.variables (group_vars).
    """
    def get(self, request, pk, **kwargs):
        from awx.main.models import Group
        group = get_object_or_404(Group, pk=pk)
        gvars = group.variables_dict or {}
        host_roles = gvars.get('host_roles', [])
        if isinstance(host_roles, str):
            host_roles = [r.strip() for r in host_roles.split(',') if r.strip()]

        project_id = request.query_params.get('project_id') or _infer_project_id_for_roles(group, host_roles)
        role_filter = request.query_params.get('role_name')
        only_overridden = request.query_params.get('overridden')

        results = []
        if project_id and host_roles:
            roles = [role_filter] if role_filter else host_roles
            rv_qs = (
                RoleVariable.objects
                .filter(project_id=project_id, role_name__in=roles)
                .order_by('role_name', 'var_name')
            )
            for rv in rv_qs:
                is_overridden = rv.var_name in gvars
                value = gvars[rv.var_name] if is_overridden else rv.default_value
                if only_overridden is not None:
                    want = only_overridden.lower() in ('1', 'true', 'yes')
                    if is_overridden != want:
                        continue
                results.append({
                    'group_id': group.pk,
                    'project_id': project_id,
                    'role_name': rv.role_name,
                    'var_name': rv.var_name,
                    'source': rv.source,
                    'value': value,
                    'default_value': rv.default_value,
                    'value_type': rv.value_type,
                    'is_overridden': is_overridden,
                    'has_jinja': rv.has_jinja,
                })
        return Response({
            'count': len(results),
            'results': results,
            'host_roles': host_roles,
            'project_id': project_id,
        })


class GroupRoleVariableDetailView(APIView):
    """
    PATCH  /api/v2/groups/{pk}/role_variables/{var_name}/  — set a value in group.variables
    DELETE /api/v2/groups/{pk}/role_variables/{var_name}/  — remove the variable
    """
    def _get_group(self, request, pk):
        from awx.main.models import Group
        group = get_object_or_404(Group, pk=pk)
        if not request.user.can_access(Group, 'change', group, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        return group

    def _save(self, group, gvars):
        import yaml as _yaml
        group.variables = _yaml.dump(gvars, default_flow_style=False, allow_unicode=True, sort_keys=False)
        group.save(update_fields=['variables'])

    def patch(self, request, pk, var_name, **kwargs):
        group = self._get_group(request, pk)
        if 'value' not in request.data:
            return Response({'error': "Feld 'value' fehlt."}, status=status.HTTP_400_BAD_REQUEST)
        gvars = group.variables_dict or {}
        gvars[var_name] = request.data['value']
        self._save(group, gvars)
        return Response({'var_name': var_name, 'value': gvars[var_name], 'is_overridden': True})

    def delete(self, request, pk, var_name, **kwargs):
        group = self._get_group(request, pk)
        gvars = group.variables_dict or {}
        existed = var_name in gvars
        if existed:
            del gvars[var_name]
            self._save(group, gvars)
        return Response({'var_name': var_name, 'is_overridden': False, 'removed': existed})


def _resolve_location_instance_group(location_id):
    """Return the AWX InstanceGroup for a Location UUID, or None."""
    if not location_id:
        return None
    from awx.main.models import InstanceGroup
    loc = Location.objects.filter(pk=location_id).first()
    if not loc:
        return None
    return InstanceGroup.objects.filter(name=loc.name).first()


def _resolve_location_credential(location_id):
    """Return the Machine-Credential of a runner at this Location, or None.

    Used as a fallback at launch time: when a Job Template has no machine
    credential of its own, the site's runner credential is injected. The
    template always wins when it carries its own machine credential.
    """
    if not location_id:
        return None
    from awx.main.models import Credential
    enl = (ExecutionNodeLocation.objects
           .filter(location_id=location_id, ssh_credential_id__isnull=False)
           .first())
    if not enl:
        return None
    return Credential.objects.filter(pk=enl.ssh_credential_id).first()


def _inject_runner_credential(job, location_id):
    """Attach the site's runner credential if the job has no machine credential."""
    if job.machine_credential is not None:
        return
    cred = _resolve_location_credential(location_id)
    if cred is not None:
        job.credentials.add(cred)


def _parse_env_text(text):
    """Parse KEY=VALUE lines into a dict. Ignores blank lines and # comments."""
    result = {}
    for line in (text or '').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        result[key.strip()] = value.strip()
    return result


def inject_runner_credential_for_job(job_pk):
    """Inject the runner credential and environment variables for a job.

    Called via post_save signal (on_commit) so template credentials are already
    copied before we check machine_credential. Matches runner by execution_node
    hostname; falls back to the single configured runner if only one exists.
    """
    try:
        from awx.main.models import Job, Credential
        job = Job.objects.get(pk=job_pk)
        enl = None
        execution_node = job.execution_node or job.controller_node
        if execution_node:
            enl = ExecutionNodeLocation.objects.filter(instance_hostname=execution_node).first()
        if enl is None:
            runners = ExecutionNodeLocation.objects.exclude(
                ssh_credential_id__isnull=True, environment=''
            )
            if runners.count() == 1:
                enl = runners.first()
        if enl is None:
            return

        if job.machine_credential is None and enl.ssh_credential_id:
            cred = Credential.objects.filter(pk=enl.ssh_credential_id).first()
            if cred is not None:
                job.credentials.add(cred)
                log.info('auto-injected runner credential %s into job %s', cred.name, job_pk)

        # Environment variables are injected at build_env() time in jobs.py
    except Exception:
        log.exception('inject_runner_credential_for_job failed for job %s', job_pk)


class HostRunView(APIView):
    """
    GET  /api/v2/hosts/{pk}/run/  — Job-Templates die dieses Host-Inventory nutzen
    POST /api/v2/hosts/{pk}/run/  — Template mit limit=hostname starten
         Body: {"job_template_id": N}
    """

    def get(self, request, pk, **kwargs):
        host = get_object_or_404(Host, pk=pk)
        inventory = host.inventory
        jts = JobTemplate.objects.filter(inventory=inventory).order_by('name')
        results = [
            {
                'id': jt.id,
                'name': jt.name,
                'playbook': jt.playbook,
                'project': jt.project_id,
            }
            for jt in jts
        ]
        return Response({'count': len(results), 'results': results})

    def post(self, request, pk, **kwargs):
        host = get_object_or_404(Host, pk=pk)
        jt_id = request.data.get('job_template_id')
        if not jt_id:
            return Response({'error': 'job_template_id required'}, status=status.HTTP_400_BAD_REQUEST)
        jt = get_object_or_404(JobTemplate, pk=jt_id)
        limit = request.data.get('limit', host.name)
        location_id = request.data.get('location_id')
        ig = _resolve_location_instance_group(location_id)

        try:
            job = jt.create_unified_job(limit=limit, _eager_fields={'created_by': request.user})
            if ig:
                job.instance_group = ig
                job.save(update_fields=['instance_group'])
            _inject_runner_credential(job, location_id)
            job.signal_start()
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {'job_id': job.id, 'job_url': f'/api/v2/jobs/{job.id}/'},
            status=status.HTTP_201_CREATED,
        )


# ── Runner ↔ Site-Zuordnung (Execution Node Locations) ───────────────────────

def _sync_runner_instance_group(enl):
    """Keep the AWX InstanceGroup for enl.location in sync with runner assignment.

    Called after every create/update/delete of ExecutionNodeLocation.
    Skips silently if the runner's hostname is not yet registered in AWX.
    """
    from awx.main.models import Instance, InstanceGroup
    try:
        instance = Instance.objects.get(hostname=enl.instance_hostname)
    except Instance.DoesNotExist:
        return
    # Remove instance from every non-system location group first
    system_groups = {'controlplane', 'default'}
    for ig in instance.rampart_groups.all():
        if ig.name not in system_groups:
            ig.instances.remove(instance)
    # Add to the new location group when a location is assigned
    if enl.location_id:
        ig, _ = InstanceGroup.objects.get_or_create(name=enl.location.name)
        ig.instances.add(instance)


class ExecutionNodeLocationListView(generics.ListCreateAPIView):
    """GET/POST /api/v2/execution_node_locations/"""
    serializer_class = ExecutionNodeLocationSerializer
    queryset = ExecutionNodeLocation.objects.all()
    filter_backends = [filters.SearchFilter]
    search_fields = ['instance_hostname', 'description']

    def perform_create(self, serializer):
        enl = serializer.save()
        _sync_runner_instance_group(enl)


class ExecutionNodeLocationDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/v2/execution_node_locations/{id}/"""
    serializer_class = ExecutionNodeLocationSerializer
    queryset = ExecutionNodeLocation.objects.all()

    def perform_update(self, serializer):
        enl = serializer.save()
        _sync_runner_instance_group(enl)

    def perform_destroy(self, instance):
        # Detach from instance group before deleting the record
        instance.location_id = None
        _sync_runner_instance_group(instance)
        instance.delete()


# ── Runner-Registrierung (non-K8s) ───────────────────────────────────────────
# AWX blockt POST /api/v2/instances/ ausserhalb von Kubernetes. Diese Endpunkte
# registrieren Execution Nodes über Instance.objects.register() (wie es auch der
# awx-manage provision_instance Befehl tut) und umgehen damit den K8s-Guard.

def _runner_summary(inst):
    return {
        'id': inst.id,
        'hostname': inst.hostname,
        'node_type': inst.node_type,
        'node_state': inst.node_state,
        'enabled': inst.enabled,
        'managed': inst.managed,
        'capacity': inst.capacity,
    }


class RunnerRegisterView(APIView):
    """
    POST /api/v2/runners/register/
    Body: {"hostname": "ansible03", "node_type": "execution"}

    Registers an execution/hop node as an unmanaged Instance.  The hostname must
    match the Receptor node id configured on the remote host.  The remote host
    still needs Receptor + ansible-runner set up (see deploy/PROXIES.md).
    """
    permission_classes = [IsSystemAdminOrAuditor]

    def post(self, request, **kwargs):
        hostname = (request.data.get('hostname') or '').strip()
        node_type = request.data.get('node_type', 'execution')
        if not hostname:
            return Response({'error': 'hostname required'}, status=status.HTTP_400_BAD_REQUEST)
        if not re.match(r'^[\w.-]+$', hostname):
            return Response({'error': 'invalid hostname'}, status=status.HTTP_400_BAD_REQUEST)
        if node_type not in ('execution', 'hop'):
            return Response({'error': 'node_type must be execution or hop'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            changed, inst = Instance.objects.register(
                hostname=hostname, node_type=node_type, defaults={'managed': False}
            )
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        resp = _runner_summary(inst)
        resp['changed'] = changed
        return Response(resp, status=status.HTTP_201_CREATED if changed else status.HTTP_200_OK)


class RunnerDeprovisionView(APIView):
    """
    POST /api/v2/runners/deprovision/
    Body: {"hostname": "ansible03"}

    Removes an unmanaged execution/hop node from the database.  Refuses to touch
    managed or control/hybrid nodes.
    """
    permission_classes = [IsSystemAdminOrAuditor]

    def post(self, request, **kwargs):
        hostname = (request.data.get('hostname') or '').strip()
        if not hostname:
            return Response({'error': 'hostname required'}, status=status.HTTP_400_BAD_REQUEST)
        inst = Instance.objects.filter(hostname=hostname).first()
        if not inst:
            return Response({'error': 'instance not found'}, status=status.HTTP_404_NOT_FOUND)
        if inst.managed or inst.node_type in ('control', 'hybrid'):
            return Response(
                {'error': 'cannot deprovision a managed or control/hybrid node'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        inst.delete()
        return Response({'hostname': hostname, 'deprovisioned': True})


# ── Phase 5: NetBox-Reconcile für Locations ──────────────────────────────────

class LocationReconcileView(APIView):
    """
    POST /api/v2/locations/reconcile/

    Zieht Sites aus NetBox und legt fehlende Locations an.
    Überschreibt keine lokalen Edits (Drift-Meldung statt Overwrite).

    NetBox-Zugangsdaten aus Django-Settings (Schlüssel NETBOX_URL / NETBOX_TOKEN)
    oder Umgebungsvariablen NETBOX_URL / NETBOX_TOKEN.

    Response:
      {
        "created_locations": [...],
        "updated_locations": [...],
        "drift":             [...],   ← lokale Felder die von NetBox abweichen
        "errors":            [...]
      }
    """
    permission_classes = [IsSystemAdminOrAuditor]

    def post(self, request, **kwargs):
        import urllib.request
        import urllib.error
        from django.conf import settings
        from django.utils import timezone

        netbox_url = getattr(settings, 'NETBOX_URL', os.environ.get('NETBOX_URL', '')).rstrip('/')
        netbox_token = getattr(settings, 'NETBOX_TOKEN', os.environ.get('NETBOX_TOKEN', ''))

        if not netbox_url or not netbox_token:
            return Response(
                {'error': 'NETBOX_URL und NETBOX_TOKEN müssen in Django-Settings oder Umgebungsvariablen gesetzt sein.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        headers = {
            'Authorization': f'Token {netbox_token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

        def nb_get(path: str) -> list:
            results = []
            url = f'{netbox_url}/api{path}?limit=500'
            while url:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                results.extend(data.get('results', []))
                url = data.get('next')
            return results

        errors = []
        created_locations = []
        updated_locations = []
        drift = []

        try:
            nb_sites = nb_get('/dcim/sites/')
        except Exception as exc:
            return Response({'error': f'NetBox /dcim/sites/ nicht erreichbar: {exc}'}, status=status.HTTP_502_BAD_GATEWAY)

        # Sites → Locations
        site_id_to_location: dict[int, Location] = {}
        for site in nb_sites:
            site_id = site['id']
            site_name = site['name']
            site_slug = site.get('slug', '')

            loc, created = Location.objects.get_or_create(
                netbox_site_id=site_id,
                defaults={
                    'name': site_name,
                    'netbox_site_slug': site_slug,
                    'source': Location.SOURCE_NETBOX,
                    'last_synced_at': timezone.now(),
                },
            )
            if created:
                created_locations.append(site_name)
            else:
                changed = False
                if loc.netbox_site_slug != site_slug:
                    drift.append({'location': loc.name, 'field': 'netbox_site_slug',
                                  'local': loc.netbox_site_slug, 'netbox': site_slug})
                if loc.source == Location.SOURCE_NETBOX and loc.name != site_name:
                    loc.name = site_name
                    changed = True
                if changed:
                    loc.last_synced_at = timezone.now()
                    loc.save(update_fields=['name', 'last_synced_at'])
                    updated_locations.append(site_name)
            site_id_to_location[site_id] = loc

        return Response({
            'created_locations': created_locations,
            'updated_locations': updated_locations,
            'drift': drift,
            'errors': errors,
        })


# ─── Project File Editor ──────────────────────────────────────────────────────

import pathlib
import subprocess

_ALLOWED_SUFFIXES = {'.yml', '.yaml', '.j2', '.jinja2', '.conf', '.ini', '.md', '.txt', '.cfg'}
_MAX_FILE_BYTES = 512 * 1024  # 512 KB


def _get_project_path(pk):
    """Return the on-disk path for a project, or raise Http404.

    A project that has never synced (no local_path / nothing on disk) must yield a
    clean 404, not a 500 — so any error from get_project_path() is caught here.
    """
    from awx.main.models import Project
    from django.http import Http404
    try:
        project = Project.objects.get(pk=pk)
    except Project.DoesNotExist:
        raise Http404
    try:
        raw = project.get_project_path(check_if_exists=False)
    except Exception:
        raw = None
    if not raw:
        raise Http404('Project has no on-disk path (never synced?).')
    path = pathlib.Path(raw)
    if not path.exists():
        raise Http404('Project directory not found on disk (run a project sync first).')
    return path


def _safe_resolve(project_path: pathlib.Path, rel: str) -> pathlib.Path:
    """Resolve rel against project_path and raise PermissionDenied on traversal."""
    from rest_framework.exceptions import PermissionDenied
    # Normalise separators, strip leading slashes
    clean = rel.replace('\\', '/').lstrip('/')
    resolved = (project_path / clean).resolve()
    try:
        resolved.relative_to(project_path.resolve())
    except ValueError:
        raise PermissionDenied('Path traversal detected.')
    return resolved


def _refresh_playbook_cache(pk):
    """Re-derive Project.playbook_files from disk so the native Job-Template
    playbook picker sees editor/upload changes without a full project sync.

    The native picker reads the cached playbook_files JSONField, which AWX only
    refreshes when a ProjectUpdate completes. Project.playbooks walks the disk
    via could_be_playbook() — exactly the list the picker expects.
    """
    from awx.main.models import Project
    try:
        proj = Project.objects.get(pk=pk)
        proj.playbook_files = proj.playbooks
        proj.save(update_fields=['playbook_files'])
    except Exception:
        log.exception('playbook_files cache refresh failed for project %s', pk)


class ProjectFilesListView(APIView):
    """
    GET /api/v2/projects/{pk}/files/?path=roles/img_docker  — one-level directory listing
    GET /api/v2/projects/{pk}/files/?search=docker          — recursive flat search (filename contains)
    """
    def get(self, request, pk, **kwargs):
        project_path = _get_project_path(pk)
        search = request.query_params.get('search', '').strip().lower()

        if search:
            matches = []
            for item in sorted(project_path.rglob('*'), key=lambda p: str(p)):
                if item.name.startswith('.') or not item.is_file():
                    continue
                rel = str(item.relative_to(project_path))
                if search in item.name.lower() or search in rel.lower():
                    matches.append({
                        'name': item.name,
                        'type': 'file',
                        'path': rel,
                        'size': item.stat().st_size,
                        'suffix': item.suffix,
                    })
            return Response({'search': search, 'entries': matches})

        rel = request.query_params.get('path', '')
        target = _safe_resolve(project_path, rel) if rel else project_path.resolve()

        if not target.is_dir():
            return Response({'detail': 'Not a directory.'}, status=400)

        entries = []
        for item in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name)):
            if item.name.startswith('.'):
                continue
            entries.append({
                'name': item.name,
                'type': 'file' if item.is_file() else 'dir',
                'path': str(item.relative_to(project_path)),
                'size': item.stat().st_size if item.is_file() else None,
                'suffix': item.suffix if item.is_file() else None,
            })
        return Response({'path': rel or '', 'entries': entries})


class ProjectFileContentView(APIView):
    """
    GET /api/v2/projects/{pk}/files/content/?path=roles/img_docker/tasks/main.yml
    PUT /api/v2/projects/{pk}/files/content/?path=...
        Body: {"content": "---\n..."}
    """
    def get(self, request, pk, **kwargs):
        project_path = _get_project_path(pk)
        rel = request.query_params.get('path', '')
        if not rel:
            return Response({'detail': 'path parameter required.'}, status=400)

        target = _safe_resolve(project_path, rel)
        if not target.is_file():
            return Response({'detail': 'File not found.'}, status=404)
        if target.suffix not in _ALLOWED_SUFFIXES:
            return Response({'detail': 'File type not allowed.'}, status=403)
        if target.stat().st_size > _MAX_FILE_BYTES:
            return Response({'detail': 'File too large (max 512 KB).'}, status=413)

        try:
            content = target.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            return Response({'detail': 'File is not valid UTF-8.'}, status=400)

        return Response({
            'path': rel,
            'content': content,
            'size': target.stat().st_size,
            'suffix': target.suffix,
        })

    def put(self, request, pk, **kwargs):
        if not request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only superusers may write project files.')

        project_path = _get_project_path(pk)
        rel = request.query_params.get('path', '')
        if not rel:
            return Response({'detail': 'path parameter required.'}, status=400)

        content = request.data.get('content')
        if content is None:
            return Response({'detail': '"content" field required.'}, status=400)
        if len(content.encode('utf-8')) > _MAX_FILE_BYTES:
            return Response({'detail': 'Content too large (max 512 KB).'}, status=413)

        target = _safe_resolve(project_path, rel)
        if target.suffix not in _ALLOWED_SUFFIXES:
            return Response({'detail': 'File type not allowed.'}, status=403)

        # Create parent dirs if needed (within project only)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')

        # Keep the native playbook picker in sync when a playbook is written
        if target.suffix in {'.yml', '.yaml'}:
            _refresh_playbook_cache(pk)

        # Optional: git add + commit (silently skip if not a git repo)
        try:
            repo = project_path.resolve()
            subprocess.run(
                ['git', 'add', str(target)],
                cwd=str(repo), capture_output=True, timeout=10
            )
            subprocess.run(
                ['git', 'commit', '-m', f'awx-ng editor: update {rel}',
                 '--author', f'{request.user.username} <awx-ng@localhost>'],
                cwd=str(repo), capture_output=True, timeout=10
            )
        except Exception:
            pass  # git not available or not a repo — write succeeded anyway

        # Auto-rescan DB when a role defaults or vars file is saved
        rescan_info = None
        m = re.match(r'^roles/([^/]+)/(defaults|vars)/main\.yml$', rel)
        if m:
            role_name = m.group(1)
            try:
                from awx.customvars.extract import extract_role, extract_role_tags, extract_role_handlers
                role_dir = project_path / 'roles' / role_name
                project_id_int = int(pk)
                revision = 'editor'
                extracted = extract_role(role_dir, project_id_int, revision)
                RoleVariable.objects.filter(project_id=project_id_int, role_name=role_name).delete()
                RoleVariable.objects.bulk_create([RoleVariable(**v) for v in extracted])
                tags = extract_role_tags(role_dir)
                RoleTag.objects.filter(project_id=project_id_int, role_name=role_name).delete()
                RoleTag.objects.bulk_create([
                    RoleTag(
                        project_id=project_id_int, role_name=role_name,
                        tag_name=t, task_count=c, scanned_revision=revision,
                    )
                    for t, c in tags.items()
                ])
                handlers = extract_role_handlers(role_dir)
                RoleHandler.objects.filter(project_id=project_id_int, role_name=role_name).delete()
                RoleHandler.objects.bulk_create([
                    RoleHandler(
                        project_id=project_id_int, role_name=role_name,
                        scanned_revision=revision, **h,
                    )
                    for h in handlers
                ])
                rescan_info = {'role': role_name, 'vars': len(extracted)}
            except Exception as exc:
                rescan_info = {'role': role_name, 'error': str(exc)}

        resp = {'path': rel, 'saved': True}
        if rescan_info:
            resp['rescanned_role'] = rescan_info
        return Response(resp)

    def delete(self, request, pk, **kwargs):
        if not request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only superusers may delete project files.')

        project_path = _get_project_path(pk)
        rel = request.query_params.get('path', '')
        if not rel:
            return Response({'detail': 'path parameter required.'}, status=400)

        target = _safe_resolve(project_path, rel)
        is_dir = target.is_dir()
        if not is_dir and not target.is_file():
            return Response({'detail': 'Not found.'}, status=404)

        # For role directories: remove DB records before touching disk
        if is_dir:
            parts = target.relative_to(project_path).parts
            if len(parts) == 2 and parts[0] == 'roles':
                project_id_int = int(pk)
                role_name = target.name
                RoleVariable.objects.filter(project_id=project_id_int, role_name=role_name).delete()
                RoleTag.objects.filter(project_id=project_id_int, role_name=role_name).delete()
                RoleHandler.objects.filter(project_id=project_id_int, role_name=role_name).delete()

        # git rm removes from index and disk atomically; fall back to manual removal
        repo = project_path.resolve()
        git_rm = subprocess.run(
            ['git', 'rm', '-rf', str(target)],
            cwd=str(repo), capture_output=True, timeout=15,
        )
        if git_rm.returncode != 0:
            # Not tracked or not a git repo — delete from filesystem manually
            if is_dir:
                shutil.rmtree(target, ignore_errors=True)
            elif target.exists():
                target.unlink()

        try:
            subprocess.run(
                ['git', 'commit', '-m', f'awx-ng editor: delete {rel}',
                 '--author', f'{request.user.username} <awx-ng@localhost>'],
                cwd=str(repo), capture_output=True, timeout=10,
            )
        except Exception:
            pass

        # Refresh the native playbook picker after a playbook (or dir) is removed
        if is_dir or target.suffix in {'.yml', '.yaml'}:
            _refresh_playbook_cache(pk)

        return Response(status=204)


class ProjectFileLintView(APIView):
    """
    POST /api/v2/projects/{pk}/files/lint/
    Body: {"content": "---\n...", "path": "roles/img_docker/tasks/main.yml"}
    Returns: {"valid": bool, "errors": [{"line", "col", "message", "severity"}]}
    """
    def post(self, request, pk, **kwargs):
        # Just verify the project exists
        _get_project_path(pk)

        content = request.data.get('content', '')
        errors = []

        # ── Stufe 1: PyYAML Syntax-Check ─────────────────────────────────────
        import yaml as _yaml
        try:
            list(_yaml.safe_load_all(content))
        except _yaml.YAMLError as exc:
            mark = getattr(exc, 'problem_mark', None)
            errors.append({
                'line': (mark.line + 1) if mark else 1,
                'col': (mark.column + 1) if mark else 1,
                'message': str(exc.problem) if hasattr(exc, 'problem') else str(exc),
                'severity': 'error',
                'source': 'yaml',
            })
            return Response({'valid': False, 'errors': errors})

        # ── Stufe 2: ansible-lint (graceful fallback) ─────────────────────────
        try:
            result = subprocess.run(
                ['ansible-lint', '--format', 'json', '--nocolor', '-'],
                input=content.encode('utf-8'),
                capture_output=True,
                timeout=30,
            )
            if result.returncode not in (0, 2):
                raise RuntimeError('ansible-lint not available')

            lint_output = result.stdout.decode('utf-8', errors='replace').strip()
            if lint_output:
                for item in json.loads(lint_output):
                    errors.append({
                        'line': item.get('line', 1),
                        'col': item.get('col', 1),
                        'message': item.get('message', str(item)),
                        'severity': 'warning' if item.get('severity') != 'error' else 'error',
                        'source': 'ansible-lint',
                        'rule': item.get('rule', {}).get('id', ''),
                    })
        except (FileNotFoundError, RuntimeError, json.JSONDecodeError, subprocess.TimeoutExpired):
            pass  # ansible-lint not installed — YAML syntax check already done

        return Response({'valid': True, 'errors': errors})


class ProjectFileRenameView(APIView):
    """
    POST /api/v2/projects/{pk}/files/rename/
    Body: {"from_path": "roles/img_docker", "to_path": "roles/img_docker2"}
    Renames or moves a file or directory within the project.
    Updates DB role records when a role directory is renamed.
    """
    def post(self, request, pk, **kwargs):
        if not request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only superusers may rename project files.')

        project_path = _get_project_path(pk)
        from_rel = (request.data.get('from_path') or '').strip()
        to_rel = (request.data.get('to_path') or '').strip()
        if not from_rel or not to_rel:
            return Response({'detail': 'from_path and to_path are required.'}, status=400)

        from_abs = _safe_resolve(project_path, from_rel)
        to_abs = _safe_resolve(project_path, to_rel)

        if not from_abs.exists():
            return Response({'detail': 'Source not found.'}, status=404)
        if to_abs.exists():
            return Response({'detail': 'Target already exists.'}, status=409)

        repo = project_path.resolve()

        # git mv; fall back to shutil.move if not tracked
        git_mv = subprocess.run(
            ['git', 'mv', str(from_abs), str(to_abs)],
            cwd=str(repo), capture_output=True, timeout=15,
        )
        if git_mv.returncode != 0:
            to_abs.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(from_abs), str(to_abs))

        try:
            subprocess.run(
                ['git', 'commit', '-m', f'awx-ng editor: rename {from_rel} → {to_rel}',
                 '--author', f'{request.user.username} <awx-ng@localhost>'],
                cwd=str(repo), capture_output=True, timeout=10,
            )
        except Exception:
            pass

        # When a role directory is renamed: update all DB records
        project_id_int = int(pk)
        try:
            from_parts = from_abs.relative_to(project_path).parts
            to_parts = to_abs.relative_to(project_path).parts
        except ValueError:
            from_parts = to_parts = ()
        if (len(from_parts) == 2 and from_parts[0] == 'roles' and
                len(to_parts) == 2 and to_parts[0] == 'roles'):
            old_role, new_role = from_parts[1], to_parts[1]
            RoleVariable.objects.filter(project_id=project_id_int, role_name=old_role).update(role_name=new_role)
            RoleTag.objects.filter(project_id=project_id_int, role_name=old_role).update(role_name=new_role)
            RoleHandler.objects.filter(project_id=project_id_int, role_name=old_role).update(role_name=new_role)

        # A rename can move/rename a playbook — refresh the native picker
        _refresh_playbook_cache(pk)

        return Response({'renamed': True, 'from_path': from_rel, 'to_path': to_rel})


# Archive suffixes handled by ProjectFilesUploadView
_ARCHIVE_ZIP_SUFFIX = '.zip'
_ARCHIVE_TAR_SUFFIXES = {'.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tar.xz', '.txz'}
_UPLOAD_ALLOWED_SUFFIXES = _ALLOWED_SUFFIXES | {'.zip', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tar.xz', '.txz', '.gz'}


def _is_safe_tar_member(member_name: str) -> bool:
    """Reject absolute paths and directory traversal in tar member names."""
    if member_name.startswith('/'):
        return False
    parts = member_name.replace('\\', '/').split('/')
    return '..' not in parts


class ProjectFilesUploadView(APIView):
    """
    POST /api/v2/projects/{pk}/files/upload/

    Upload a single file or an archive (ZIP / tar.gz / tgz / tar.bz2 / …) into
    the project directory. After writing, roles/ changes trigger a DB re-scan.

    Multipart form fields:
      file  — the uploaded file (required)
      path  — target directory inside the project, e.g. "roles/" or "playbooks/"
              (optional, defaults to "" = project root)
    """
    parser_classes = [
        __import__('rest_framework.parsers', fromlist=['MultiPartParser']).MultiPartParser,
        __import__('rest_framework.parsers', fromlist=['FormParser']).FormParser,
    ]

    def post(self, request, pk, **kwargs):
        import zipfile
        import tarfile as tarfilemod
        import io

        if not request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only superusers may upload project files.')

        project_path = _get_project_path(pk)
        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'file field required.'}, status=400)

        target_dir_rel = (request.data.get('path') or '').strip().strip('/')
        if target_dir_rel:
            target_dir = _safe_resolve(project_path, target_dir_rel)
        else:
            target_dir = project_path

        filename = upload.name
        # Determine archive type by suffix (handle compound suffixes like .tar.gz)
        fname_lower = filename.lower()
        is_zip = fname_lower.endswith('.zip')
        is_tar = any(fname_lower.endswith(s) for s in _ARCHIVE_TAR_SUFFIXES)

        created = []

        if is_zip:
            target_dir.mkdir(parents=True, exist_ok=True)
            data = upload.read()
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        member_name = info.filename
                        if not _is_safe_tar_member(member_name):
                            continue
                        dest = _safe_resolve(target_dir, member_name)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(zf.read(info.filename))
                        created.append(str(dest.relative_to(project_path)))
            except zipfile.BadZipFile as exc:
                return Response({'detail': f'Invalid ZIP archive: {exc}'}, status=400)

        elif is_tar:
            target_dir.mkdir(parents=True, exist_ok=True)
            data = upload.read()
            try:
                with tarfilemod.open(fileobj=io.BytesIO(data)) as tf:
                    for member in tf.getmembers():
                        if not member.isfile():
                            continue
                        if not _is_safe_tar_member(member.name):
                            continue
                        dest = _safe_resolve(target_dir, member.name)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        fobj = tf.extractfile(member)
                        if fobj:
                            dest.write_bytes(fobj.read())
                            created.append(str(dest.relative_to(project_path)))
            except tarfilemod.TarError as exc:
                return Response({'detail': f'Invalid tar archive: {exc}'}, status=400)

        else:
            # Single file upload
            suffix = pathlib.Path(filename).suffix.lower()
            if suffix not in _UPLOAD_ALLOWED_SUFFIXES:
                return Response({'detail': f'File type "{suffix}" not allowed.'}, status=403)
            dest = _safe_resolve(target_dir, filename)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(upload.read())
            created.append(str(dest.relative_to(project_path)))

        # Trigger role DB re-scan for any role that was touched
        roles_touched = set()
        for rel_path in created:
            parts = pathlib.Path(rel_path).parts
            if len(parts) >= 2 and parts[0] == 'roles':
                roles_touched.add(parts[1])

        if roles_touched:
            try:
                from awx.customvars.extract import scan_project_roles
                project_id_int = int(pk)
                scan_project_roles(project_id_int, str(project_path), 'upload')
            except Exception:
                pass  # best-effort — files are written regardless

        # Refresh the native playbook picker if any playbook was uploaded
        if any(str(p).endswith(('.yml', '.yaml')) for p in created):
            _refresh_playbook_cache(pk)

        return Response({'created': created, 'count': len(created)}, status=201)


def _pb_value_type(v):
    """Return a simple type string for a playbook variable value."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, int):
        return 'int'
    if isinstance(v, float):
        return 'float'
    if isinstance(v, dict):
        return 'dict'
    if isinstance(v, list):
        return 'list'
    return 'str'


def _extract_plays(content):
    """Parse a playbook's YAML and return per-play metadata (hosts/roles/tags/vars)."""
    import yaml as _yaml
    import re as _re
    plays = []
    try:
        doc = _yaml.safe_load(content)
    except _yaml.YAMLError:
        return plays
    if not isinstance(doc, list):
        return plays
    for entry in doc:
        if not isinstance(entry, dict):
            continue
        if 'import_playbook' in entry or 'ansible.builtin.import_playbook' in entry:
            plays.append({
                'name': entry.get('import_playbook') or entry.get('ansible.builtin.import_playbook'),
                'kind': 'import_playbook',
                'hosts': None,
                'roles': [],
                'tags': [],
                'vars': [],
                'vars_prompt': [],
                'vars_count': 0,
            })
            continue
        roles = []
        for r in entry.get('roles', []) or []:
            if isinstance(r, str):
                roles.append(r)
            elif isinstance(r, dict):
                roles.append(r.get('role') or r.get('name') or '')
        tags = entry.get('tags', [])
        if isinstance(tags, str):
            tags = [tags]
        hosts = entry.get('hosts')

        # Extract vars: block
        play_vars = []
        raw_vars = entry.get('vars')
        if isinstance(raw_vars, dict):
            for k, v in raw_vars.items():
                raw_block = _yaml.dump({k: v}, default_flow_style=False, allow_unicode=True).strip()
                has_jinja = bool(_re.search(r'\{\{.*?\}\}', str(v)))
                play_vars.append({
                    'name': k,
                    'value': v if not isinstance(v, (dict, list)) else v,
                    'value_type': _pb_value_type(v),
                    'raw_yaml': raw_block,
                    'has_jinja': has_jinja,
                })

        # Extract vars_prompt: block
        play_vars_prompt = []
        for vp in (entry.get('vars_prompt') or []):
            if isinstance(vp, dict) and vp.get('name'):
                play_vars_prompt.append({
                    'name': vp['name'],
                    'prompt': vp.get('prompt', ''),
                    'private': bool(vp.get('private', False)),
                    'default': vp.get('default'),
                })

        plays.append({
            'name': entry.get('name', ''),
            'kind': 'play',
            'hosts': hosts if isinstance(hosts, str) else (str(hosts) if hosts is not None else None),
            'roles': [r for r in roles if r],
            'tags': tags or [],
            'vars': play_vars,
            'vars_prompt': play_vars_prompt,
            'vars_count': len(play_vars) + len(play_vars_prompt),
        })
    return plays


def _list_project_playbooks(pk, project_path):
    """List a project's playbooks — only from ./playbooks/ (Ansible convention).

    Primary source: AWX's own sync-time detection (proj.playbooks), filtered to
    entries that live under playbooks/. Fallback: live-scan ./playbooks/ from disk.
    Root-level .yml files are intentionally excluded to enforce the convention.
    """
    rels = []
    try:
        from awx.main.models import Project
        proj = Project.objects.get(pk=pk)
        # enforce convention: only files inside playbooks/
        rels = [p for p in (proj.playbooks or []) if p.startswith('playbooks/')]
    except Exception:
        rels = []
    if not rels:
        pb_dir = project_path / 'playbooks'
        if pb_dir.is_dir():
            cand = [p for p in pb_dir.rglob('*.yml') if p.is_file()]
            cand += [p for p in pb_dir.rglob('*.yaml') if p.is_file()]
            rels = [str(p.relative_to(project_path)) for p in cand]
    return sorted(set(rels))


class ProjectPlaysView(APIView):
    """
    GET /api/v2/projects/{pk}/plays/                — list of playbooks (fast, no parsing)
    GET /api/v2/projects/{pk}/plays/?playbook=<rel> — play metadata (hosts/roles/tags) of ONE playbook

    The list comes from AWX's playbook detection (recursive, incl. subfolders like
    playbooks/ and bootstrap/). Plays are parsed only when a row is expanded
    (with ?playbook=) — important for projects with hundreds of playbooks.
    """
    def get(self, request, pk, **kwargs):
        project_path = _get_project_path(pk)
        wanted = request.query_params.get('playbook')

        # Single playbook: parse plays (lazy, on expand)
        if wanted:
            path = _safe_resolve(project_path, wanted)
            plays = []
            if path.is_file() and path.suffix in ('.yml', '.yaml'):
                try:
                    if path.stat().st_size <= _MAX_FILE_BYTES:
                        plays = _extract_plays(path.read_text(encoding='utf-8'))
                except (OSError, UnicodeDecodeError):
                    plays = []
            return Response({'playbook': wanted, 'plays': plays})

        # List: paths only, no parsing
        rels = _list_project_playbooks(pk, project_path)
        return Response({
            'count': len(rels),
            'results': [{'playbook': r} for r in rels],
        })


class ProjectVariableUsagesView(APIView):
    """
    GET /api/v2/projects/{pk}/variable_usages/?role=<role>&var=<var_name>

    Returns every block across the role that defines or references the variable:
    the definition block in defaults/vars plus each task/template block that uses
    it. Blocks are split with the YAML library (PyYAML node line marks) and a
    grep-with-context fallback for non-YAML files.
    """
    def get(self, request, pk, **kwargs):
        project_path = _get_project_path(pk)
        role = request.query_params.get('role', '')
        var = request.query_params.get('var', '')
        if not role or not var:
            return Response({'detail': 'role and var query params required.'}, status=400)
        if not re.match(r'^[\w.-]+$', role) or not re.match(r'^[\w.-]+$', var):
            return Response({'detail': 'invalid role or var name.'}, status=400)

        role_dir = _safe_resolve(project_path, f'roles/{role}')
        if not role_dir.is_dir():
            return Response({'detail': 'role not found on disk.'}, status=404)

        from awx.customvars.extract import find_variable_blocks
        blocks = find_variable_blocks(role_dir, var)
        return Response({
            'role': role,
            'var': var,
            'count': len(blocks),
            'results': blocks,
        })


class ProjectLaunchView(APIView):
    """
    POST /api/v2/projects/{pk}/launch/
    Body: {"job_template_id": N, "limit": "optional-pattern"}

    Launches an existing Job Template that belongs to this project with an
    arbitrary limit override.  Uses create_unified_job() directly so the limit
    is always honoured regardless of ask_limit_on_launch on the template.
    """
    def post(self, request, pk, **kwargs):
        jt_id = request.data.get('job_template_id')
        limit = request.data.get('limit', '')
        location_id = request.data.get('location_id')
        ig = _resolve_location_instance_group(location_id)
        if not jt_id:
            return Response({'error': 'job_template_id required'}, status=status.HTTP_400_BAD_REQUEST)
        jt = get_object_or_404(JobTemplate, pk=jt_id, project_id=pk)

        try:
            job = jt.create_unified_job(limit=limit, _eager_fields={'created_by': request.user})
            if ig:
                job.instance_group = ig
                job.save(update_fields=['instance_group'])
            _inject_runner_credential(job, location_id)
            job.signal_start()
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {'job_id': job.id, 'job_url': f'/api/v2/jobs/{job.id}/'},
            status=status.HTTP_201_CREATED,
        )
