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
// Register a new execution/hop node (runner). AWX blocks POST /instances/ outside
// Kubernetes, so this goes through a custom endpoint that uses Instance.register().
export function registerRunner(hostname, nodeType = 'execution') {
  return LocationsAPI.http.post('/api/v2/runners/register/', {
    hostname,
    node_type: nodeType,
  });
}
// Trigger an async health check on an execution node
export function triggerInstanceHealthCheck(instanceId) {
  return LocationsAPI.http.post(`/api/v2/instances/${instanceId}/health_check/`);
}
// Read the last health check result (capacity, errors, …)
export function readInstanceHealthCheck(instanceId) {
  return LocationsAPI.http.get(`/api/v2/instances/${instanceId}/health_check/`);
}
// Deprovision (remove) an unmanaged runner via the custom endpoint
export function deprovisionRunner(hostname) {
  return LocationsAPI.http.post('/api/v2/runners/deprovision/', { hostname });
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
export function runHost(hostId, jobTemplateId, limit, locationId) {
  return LocationsAPI.http.post(`/api/v2/hosts/${hostId}/run/`, {
    job_template_id: jobTemplateId,
    ...(limit !== undefined ? { limit } : {}),
    ...(locationId ? { location_id: locationId } : {}),
  });
}
// All job templates for a project (for the Run dialog on the Playbooks screen)
export function readProjectJobTemplates(projectId) {
  return LocationsAPI.http.get('/api/v2/job_templates/', {
    params: { project: projectId, page_size: 200, order_by: 'playbook' },
  });
}
// Launch a job template that belongs to a project with an optional limit + location
export function launchProjectPlaybook(projectId, jtId, limit, locationId) {
  return LocationsAPI.http.post(`/api/v2/projects/${projectId}/launch/`, {
    job_template_id: jtId,
    limit: limit || '',
    ...(locationId ? { location_id: locationId } : {}),
  });
}
// All configured Locations (Sites) — used by Run modals for runner selection
export function readLocations(params) {
  return LocationsAPI.http.get('/api/v2/locations/', { params });
}

export function renameProjectFile(projectId, fromPath, toPath) {
  return LocationsAPI.http.post(`/api/v2/projects/${projectId}/files/rename/`, {
    from_path: fromPath,
    to_path: toPath,
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
export function uploadProjectFile(projectId, targetPath, file) {
  const form = new FormData();
  form.append('file', file);
  form.append('path', targetPath);
  return LocationsAPI.http.post(
    `/api/v2/projects/${projectId}/files/upload/`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
}

// ── Personal OAuth2 tokens (work for both /api/v2/ and /mcp) ─────────────────
export function listMyTokens() {
  return LocationsAPI.http.get('/api/v2/tokens/');
}
export function createToken(data) {
  return LocationsAPI.http.post('/api/v2/tokens/', data);
}
export function deleteToken(tokenId) {
  return LocationsAPI.http.delete(`/api/v2/tokens/${tokenId}/`);
}
export function readMe() {
  return LocationsAPI.http.get('/api/v2/me/');
}
