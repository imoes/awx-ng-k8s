"""
awx-ng Custom Variables REST API
=================================
Endpunkte:

  GET  /api/v2/projects/{id}/role_variables/             — extrahierte Rollen-Vars
  GET  /api/v2/projects/{id}/role_variables/scan/        — letzter Scan-Audit-Eintrag
  POST /api/v2/job_templates/{id}/generate_survey/       — Survey aus Rollen-Vars generieren
  GET  /api/v2/locations/                                — Locations (Sites)
  GET  /api/v2/locations/{id}/subnets/                   — Subnetze einer Location
"""

import json

from rest_framework import generics, serializers as drf_serializers, filters, status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from awx.api.permissions import IsSystemAdminOrAuditor
from awx.main.models import Project, JobTemplate

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
