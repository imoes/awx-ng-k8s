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
  GET  /api/v2/locations/{id}/subnets/                   — Subnetze einer Location
  POST /api/v2/locations/reconcile/                      — NetBox-Reconcile
"""

import crypt
import json
import os

from rest_framework import generics, serializers as drf_serializers, filters, status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from awx.api.permissions import IsSystemAdminOrAuditor
from awx.main.models import Project, JobTemplate, Host

from .models import RoleVariable, RoleScan, Location, Subnet


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


class RoleScanSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = RoleScan
        fields = [
            'id', 'project_id', 'scanned_at',
            'revision', 'roles_found', 'vars_extracted', 'errors',
        ]


class LocationSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = [
            'id', 'name', 'description',
            'netbox_site_id', 'netbox_site_slug',
            'source', 'last_synced_at',
            'created_at', 'updated_at',
        ]


class SubnetSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = Subnet
        fields = [
            'id', 'location', 'cidr', 'vlan', 'gateway',
            'netbox_prefix_id', 'source', 'created_at',
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
    def get(self, request, project_id):
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

    def post(self, request, project_id):
        project = get_object_or_404(Project, pk=project_id)
        project_path = project.get_project_path(check_if_exists=False)
        revision = project.scm_revision or ''
        from awx.customvars.extract import scan_project_roles
        result = scan_project_roles(project.pk, project_path, revision)
        return Response(result, status=status.HTTP_200_OK)


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


class SubnetListView(generics.ListCreateAPIView):
    """GET/POST /api/v2/locations/{location_id}/subnets/"""
    serializer_class = SubnetSerializer

    def get_queryset(self):
        location_id = self.kwargs['location_id']
        get_object_or_404(Location, pk=location_id)
        return Subnet.objects.filter(location_id=location_id)

    def perform_create(self, serializer):
        location_id = self.kwargs['location_id']
        location = get_object_or_404(Location, pk=location_id)
        serializer.save(location=location)


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

    def post(self, request, pk):
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
      1. role_defaults  (aus RoleVariable, roles listed in host_roles)
      2. group_vars     (alle Gruppen des Hosts, flach gemerged)
      3. host_vars      (Host.variables_dict)

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

    def get(self, request, pk):
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
            role_vars_qs = (
                RoleVariable.objects
                .filter(
                    role_name__in=host_roles,
                    source='defaults',
                )
                .order_by('role_name', 'var_name')
            )
            role_defaults: dict = {}
            for rv in role_vars_qs:
                if rv.var_name not in role_defaults:
                    role_defaults[rv.var_name] = (rv.default_value, rv.role_name)
            for var_name, (val, role_name) in role_defaults.items():
                _apply({var_name: val}, {'source': 'role_default', 'role': role_name})

        # 2. Group vars (Elterngruppen zuerst, dann direkte Gruppen)
        all_groups = list(host.all_groups().order_by('name'))
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

    def post(self, request):
        password = request.data.get('password', '')
        if not password or not isinstance(password, str):
            return Response({'error': "'password' ist Pflichtfeld (String)."}, status=status.HTTP_400_BAD_REQUEST)
        hashed = crypt.crypt(password, crypt.mksalt(crypt.METHOD_SHA512))
        return Response({'hash': hashed})


class HostSetRootPasswordView(APIView):
    """
    POST /api/v2/hosts/{pk}/set_root_password/

    Body: {"password": "plaintext", "var_name": "rootpw"}
    Hasht das Passwort (sha512) und schreibt es in Host.variables.
    Der Klartext wird nicht gespeichert.
    """

    def post(self, request, pk):
        host = get_object_or_404(Host, pk=pk)
        if not request.user.can_access(Host, 'change', host, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

        password = request.data.get('password', '')
        var_name = request.data.get('var_name', 'rootpw')
        if not password or not isinstance(password, str):
            return Response({'error': "'password' ist Pflichtfeld."}, status=status.HTTP_400_BAD_REQUEST)

        hashed = crypt.crypt(password, crypt.mksalt(crypt.METHOD_SHA512))
        hvars = host.variables_dict or {}
        hvars[var_name] = hashed

        import yaml as _yaml
        host.variables = _yaml.dump(hvars, default_flow_style=False, allow_unicode=True)
        host.save(update_fields=['variables'])

        return Response({'var_name': var_name, 'status': 'set', 'hash_prefix': hashed[:10] + '...'})


class HostAssignRolesView(APIView):
    """
    POST /api/v2/hosts/{pk}/assign_roles/

    Body: {"roles": ["img_docker", "img_system"]}
    Schreibt host_roles in Host.variables_dict.
    Ein generisches site.yml-Template liest host_roles und führt die Rollen aus.
    """

    def post(self, request, pk):
        host = get_object_or_404(Host, pk=pk)
        if not request.user.can_access(Host, 'change', host, None):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

        roles = request.data.get('roles', [])
        if not isinstance(roles, list):
            return Response({'error': "'roles' muss eine Liste sein."}, status=status.HTTP_400_BAD_REQUEST)

        hvars = host.variables_dict or {}
        hvars['host_roles'] = roles

        import yaml as _yaml
        host.variables = _yaml.dump(hvars, default_flow_style=False, allow_unicode=True)
        host.save(update_fields=['variables'])

        return Response({'host_id': host.pk, 'host_name': host.name, 'host_roles': roles})


# ── Phase 5: NetBox-Reconcile für Locations/Subnets ──────────────────────────

class LocationReconcileView(APIView):
    """
    POST /api/v2/locations/reconcile/

    Zieht Sites + Prefixes aus NetBox und legt fehlende Locations/Subnets an.
    Überschreibt keine lokalen Edits (Drift-Meldung statt Overwrite).

    NetBox-Zugangsdaten aus Django-Settings (Schlüssel NETBOX_URL / NETBOX_TOKEN)
    oder Umgebungsvariablen NETBOX_URL / NETBOX_TOKEN.

    Response:
      {
        "created_locations": [...],
        "updated_locations": [...],
        "created_subnets":   [...],
        "drift":             [...],   ← lokale Felder die von NetBox abweichen
        "errors":            [...]
      }
    """
    permission_classes = [IsSystemAdminOrAuditor]

    def post(self, request):
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
        created_subnets = []
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

        # Prefixes → Subnets
        try:
            nb_prefixes = nb_get('/ipam/prefixes/')
        except Exception as exc:
            errors.append(f'NetBox /ipam/prefixes/ nicht erreichbar: {exc}')
            nb_prefixes = []

        for prefix in nb_prefixes:
            # Scope auf Site prüfen (NetBox 4.x: scope_type + scope)
            site_id = None
            scope = prefix.get('scope')
            scope_type = prefix.get('scope_type', '')
            if scope and 'dcim.site' in scope_type:
                site_id = scope.get('id') if isinstance(scope, dict) else None
            # Fallback: älteres NetBox mit direktem site-Feld
            if site_id is None and isinstance(prefix.get('site'), dict):
                site_id = prefix['site'].get('id')

            if site_id not in site_id_to_location:
                continue

            loc = site_id_to_location[site_id]
            cidr = prefix.get('prefix', '')
            if not cidr:
                continue

            subnet, created = Subnet.objects.get_or_create(
                location=loc,
                cidr=cidr,
                defaults={
                    'netbox_prefix_id': prefix['id'],
                    'source': 'netbox',
                    'vlan': (prefix.get('vlan') or {}).get('vid') if isinstance(prefix.get('vlan'), dict) else None,
                },
            )
            if created:
                created_subnets.append(f'{cidr} @ {loc.name}')
            else:
                if subnet.netbox_prefix_id != prefix['id'] and subnet.netbox_prefix_id is not None:
                    drift.append({'subnet': cidr, 'location': loc.name,
                                  'field': 'netbox_prefix_id',
                                  'local': subnet.netbox_prefix_id,
                                  'netbox': prefix['id']})

        return Response({
            'created_locations': created_locations,
            'updated_locations': updated_locations,
            'created_subnets': created_subnets,
            'drift': drift,
            'errors': errors,
        })
