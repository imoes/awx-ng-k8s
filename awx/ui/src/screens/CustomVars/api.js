// awx-ng: API-Helfer für die customvars-Endpunkte.
// Eigenständig, damit api/index.js nicht angefasst werden muss (rebase-freundlich).
import Base from 'api/Base';

class CustomEndpoint extends Base {
  constructor(baseUrl) {
    super();
    this.baseUrl = baseUrl;
  }
}

export const LocationsAPI = new CustomEndpoint('/api/v2/locations/');
export const ExecNodeLocationsAPI = new CustomEndpoint(
  '/api/v2/execution_node_locations/'
);

// Subnetze hängen unter einer Location
export function readSubnets(locationId) {
  return LocationsAPI.http.get(`/api/v2/locations/${locationId}/subnets/`);
}
export function createSubnet(locationId, data) {
  return LocationsAPI.http.post(
    `/api/v2/locations/${locationId}/subnets/`,
    data
  );
}
export function reconcileLocations() {
  return LocationsAPI.http.post('/api/v2/locations/reconcile/', {});
}

// Hosts (für die Variablen-Verwaltung)
export function readHostRoleVariables(hostId, params) {
  return LocationsAPI.http.get(`/api/v2/hosts/${hostId}/role_variables/`, {
    params,
  });
}
export function patchHostRoleVariable(hostId, varName, value) {
  return LocationsAPI.http.patch(
    `/api/v2/hosts/${hostId}/role_variables/${encodeURIComponent(varName)}/`,
    { value }
  );
}
export function resetHostRoleVariable(hostId, varName) {
  return LocationsAPI.http.delete(
    `/api/v2/hosts/${hostId}/role_variables/${encodeURIComponent(varName)}/`
  );
}
export function assignHostRoles(hostId, roles) {
  return LocationsAPI.http.post(`/api/v2/hosts/${hostId}/assign_roles/`, {
    roles,
  });
}
export function readAggregatedVariables(hostId) {
  return LocationsAPI.http.get(`/api/v2/hosts/${hostId}/aggregated_variables/`);
}
export function cloneHost(hostId, name, copyGroups = true) {
  return LocationsAPI.http.post(`/api/v2/hosts/${hostId}/clone/`, {
    name,
    copy_groups: copyGroups,
  });
}

// Group variables (mirrors Host — single source of truth = group.variables)
export function readGroupRoleVariables(groupId, params) {
  return LocationsAPI.http.get(`/api/v2/groups/${groupId}/role_variables/`, {
    params,
  });
}
export function patchGroupRoleVariable(groupId, varName, value) {
  return LocationsAPI.http.patch(
    `/api/v2/groups/${groupId}/role_variables/${encodeURIComponent(varName)}/`,
    { value }
  );
}
export function resetGroupRoleVariable(groupId, varName) {
  return LocationsAPI.http.delete(
    `/api/v2/groups/${groupId}/role_variables/${encodeURIComponent(varName)}/`
  );
}
export function assignGroupRoles(groupId, roles) {
  return LocationsAPI.http.post(`/api/v2/groups/${groupId}/assign_roles/`, {
    roles,
  });
}

// AWX-Instanzen (= Runner / Execution Nodes) — Quelle für die Site-Zuordnung
export function readInstances(params) {
  return LocationsAPI.http.get('/api/v2/instances/', { params });
}
// Zuordnung per Instanz-Hostname anlegen oder aktualisieren (Upsert)
export function upsertExecNodeLocation(existing, payload) {
  if (existing && existing.id) {
    return ExecNodeLocationsAPI.update(existing.id, payload);
  }
  return ExecNodeLocationsAPI.create(payload);
}

// Projekte + deren Rollen (für die Rollen-Auswahl und Rollen-Verwaltung)
export function readProjects(params) {
  return LocationsAPI.http.get('/api/v2/projects/', { params });
}
export function readProjectRoleVariables(projectId, params) {
  return LocationsAPI.http.get(
    `/api/v2/projects/${projectId}/role_variables/`,
    { params }
  );
}
// Alle Rollen eines Projekts (Disk + DB, für Rollen-Verwaltungs-Screen)
export function readProjectRoles(projectId) {
  return LocationsAPI.http.get(`/api/v2/projects/${projectId}/roles/`);
}
// Scan eines Projekts manuell auslösen
export function triggerProjectRoleScan(projectId) {
  return LocationsAPI.http.post(
    `/api/v2/projects/${projectId}/role_variables/scan/trigger/`,
    {}
  );
}
// Every block across a role that defines or references a variable (grepped)
export function readVariableUsages(projectId, role, varName) {
  return LocationsAPI.http.get(
    `/api/v2/projects/${projectId}/variable_usages/`,
    { params: { role, var: varName } }
  );
}
// A project's playbooks (native AWX list) + play metadata (awx-ng scan)
export function readProjectPlaybooks(projectId) {
  return LocationsAPI.http.get(`/api/v2/projects/${projectId}/playbooks/`);
}
export function readProjectPlays(projectId, params) {
  return LocationsAPI.http.get(`/api/v2/projects/${projectId}/plays/`, {
    params,
  });
}
// Job-Templates eines Hosts (gleiche Inventory)
export function readHostJobTemplates(hostId) {
  return LocationsAPI.http.get(`/api/v2/hosts/${hostId}/run/`);
}
// Host ausführen — limit defaults to hostname on the server if omitted
export function runHost(hostId, jobTemplateId, limit) {
  return LocationsAPI.http.post(`/api/v2/hosts/${hostId}/run/`, {
    job_template_id: jobTemplateId,
    ...(limit !== undefined ? { limit } : {}),
  });
}
// All job templates for a project (for the Run dialog on the Playbooks screen)
export function readProjectJobTemplates(projectId) {
  return LocationsAPI.http.get('/api/v2/job_templates/', {
    params: { project: projectId, page_size: 200, order_by: 'playbook' },
  });
}
// Launch a job template that belongs to a project with an optional limit
export function launchProjectPlaybook(projectId, jtId, limit) {
  return LocationsAPI.http.post(`/api/v2/projects/${projectId}/launch/`, {
    job_template_id: jtId,
    limit: limit || '',
  });
}

// ── Projekt-Datei-Editor ──────────────────────────────────────────────────────
export function listProjectFiles(projectId, path = '') {
  return LocationsAPI.http.get(`/api/v2/projects/${projectId}/files/`, {
    params: path ? { path } : {},
  });
}
export function readProjectFile(projectId, path) {
  return LocationsAPI.http.get(`/api/v2/projects/${projectId}/files/content/`, {
    params: { path },
  });
}
export function saveProjectFile(projectId, path, content) {
  return LocationsAPI.http.put(
    `/api/v2/projects/${projectId}/files/content/?path=${encodeURIComponent(path)}`,
    { content }
  );
}
export function lintProjectFile(projectId, content, path = '') {
  return LocationsAPI.http.post(`/api/v2/projects/${projectId}/files/lint/`, {
    content,
    path,
  });
}
export function deleteProjectFile(projectId, path) {
  return LocationsAPI.http.delete(
    `/api/v2/projects/${projectId}/files/content/?path=${encodeURIComponent(path)}`
  );
}
