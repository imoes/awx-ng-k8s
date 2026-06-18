"""
awx-ng Custom Variables REST API
=================================
Endpunkte:

  GET  /api/v2/projects/{id}/role_variables/      — extrahierte Rollen-Vars
  GET  /api/v2/projects/{id}/role_variables/scan/ — letzter Scan-Audit-Eintrag
  GET  /api/v2/locations/                          — Locations (Sites)
  GET  /api/v2/locations/{id}/subnets/             — Subnetze einer Location
"""

from rest_framework import generics, serializers as drf_serializers, filters, status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from awx.api.permissions import IsSystemAdminOrAuditor
from awx.main.models import Project

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
