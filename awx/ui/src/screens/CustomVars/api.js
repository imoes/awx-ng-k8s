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
export function readHosts(params) {
  return LocationsAPI.http.get('/api/v2/hosts/', { params });
}
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
// Job-Templates eines Hosts (gleiche Inventory)
export function readHostJobTemplates(hostId) {
  return LocationsAPI.http.get(`/api/v2/hosts/${hostId}/run/`);
}
// Host ausführen (limit=hostname)
export function runHost(hostId, jobTemplateId) {
  return LocationsAPI.http.post(`/api/v2/hosts/${hostId}/run/`, {
    job_template_id: jobTemplateId,
  });
}
