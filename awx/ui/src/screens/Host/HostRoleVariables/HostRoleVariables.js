/* eslint-disable i18next/no-literal-string */
// awx-ng: "Role Variables" tab on the host page — the PRIMARY place to manage a
// host's variables. Single source of truth = native host.variables.
//   • Role defaults come from the project scan (roles/<name>/defaults/main.yml).
//   • A variable counts as "overridden" when it is set in host_vars.
//   • Free host_vars (criticality, docker.*, …) are edited here too; the raw YAML
//     view on the Details/Edit page stays available as an advanced escape hatch.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Checkbox,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  Modal,
  SearchInput,
  TextArea,
  TextInput,
  Title,
} from '@patternfly/react-core';
import {
  TableComposable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';
import yaml from 'js-yaml';
import { object } from 'prop-types';
import { HostsAPI } from 'api';
import {
  assignHostRoles,
  cloneHost,
  patchHostRoleVariable,
  readHostJobTemplates,
  readHostRoleVariables,
  readLocations,
  readProjectRoles,
  readProjects,
  resetHostRoleVariable,
  runHost,
} from 'screens/CustomVars/api';

// Control keys that are not "real" variables and must not show up as free host_vars.
const CONTROL_KEYS = new Set(['host_roles']);

function HostRoleVariables({ host }) {
  const hostId = host.id;

  // Project + available roles
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [roleSearch, setRoleSearch] = useState('');

  // Assigned roles + variable overrides + raw host.variables
  const [hostRoles, setHostRoles] = useState([]);
  const [hostVars, setHostVars] = useState([]);
  const [rawVars, setRawVars] = useState('');

  // Edit / reset variable. editingVar = { var_name, value, role_name?, default_value?, isFree?, isNew? }
  const [editingVar, setEditingVar] = useState(null);
  const [editName, setEditName] = useState('');
  const [editText, setEditText] = useState('');

  // Clone
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneGroups, setCloneGroups] = useState(true);

  // Run host
  const [runOpen, setRunOpen] = useState(false);
  const [jobTemplates, setJobTemplates] = useState([]);
  const [selectedJT, setSelectedJT] = useState('');
  const [runLimit, setRunLimit] = useState('');
  const [runLocations, setRunLocations] = useState([]);
  const [runLocationId, setRunLocationId] = useState('');

  // UI state
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadVars = useCallback(async () => {
    const [{ data }, detail] = await Promise.all([
      readHostRoleVariables(hostId),
      HostsAPI.readDetail(hostId),
    ]);
    setHostVars(data.results);
    setHostRoles(data.host_roles || []);
    setRawVars(detail?.data?.variables || '');
    if (data.project_id && !projectId) setProjectId(String(data.project_id));
  }, [hostId, projectId]);

  useEffect(() => {
    loadVars();
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) =>
      setProjects(data.results)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  useEffect(() => {
    if (!projectId) { setAvailableRoles([]); return; }
    readProjectRoles(projectId).then(({ data }) => {
      const roles = (data.results || []).map((r) => r.role_name).sort();
      setAvailableRoles(roles);
    });
  }, [projectId]);

  // ── Role search filter (live from 2nd char, show all if <2) ──────────────
  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    const notAssigned = availableRoles.filter((r) => !hostRoles.includes(r));
    if (q.length < 2) return notAssigned;
    return notAssigned.filter((r) => r.toLowerCase().includes(q));
  }, [availableRoles, hostRoles, roleSearch]);

  // ── Free host_vars: top-level host.variables keys that are not role vars ───
  const freeVars = useMemo(() => {
    let parsed = {};
    try { parsed = yaml.load(rawVars) || {}; } catch { parsed = {}; }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const roleVarNames = new Set(hostVars.map((v) => v.var_name));
    return Object.keys(parsed)
      .filter((k) => !CONTROL_KEYS.has(k) && !roleVarNames.has(k))
      .sort()
      .map((k) => ({ var_name: k, value: parsed[k] }));
  }, [rawVars, hostVars]);

  // ── Assign a single role immediately ──────────────────────────────────────
  const addRole = async (role) => {
    setBusy(true);
    setErr(null);
    try {
      await assignHostRoles(hostId, [...hostRoles, role]);
      setRoleSearch('');
      loadVars();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async (role) => {
    setBusy(true);
    setErr(null);
    try {
      await assignHostRoles(hostId, hostRoles.filter((r) => r !== role));
      loadVars();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Edit / reset variable ─────────────────────────────────────────────────
  const stringify = (val) =>
    typeof val === 'string' ? val : JSON.stringify(val, null, 2);

  const openEdit = (v) => {
    setEditingVar(v);
    setEditName(v.var_name);
    setEditText(stringify(v.value));
    setErr(null);
  };

  const openAddFreeVar = () => {
    setEditingVar({ var_name: '', value: '', isFree: true, isNew: true });
    setEditName('');
    setEditText('');
    setErr(null);
  };

  const saveEdit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const name = editingVar.isNew ? editName.trim() : editingVar.var_name;
      if (!name) throw new Error('Variable name required.');
      let parsed;
      try { parsed = JSON.parse(editText); } catch { parsed = editText; }
      await patchHostRoleVariable(hostId, name, parsed);
      setEditingVar(null);
      loadVars();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const resetVar = async (v) => {
    await resetHostRoleVariable(hostId, v.var_name);
    loadVars();
  };

  // ── Clone ─────────────────────────────────────────────────────────────────
  const doClone = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { data } = await cloneHost(hostId, cloneName, cloneGroups);
      setCloneOpen(false); setCloneName('');
      setMsg(`Host '${data.name}' cloned (${data.groups_copied} groups).`);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Run host ──────────────────────────────────────────────────────────────
  const openRun = async () => {
    const [jtRes, locRes] = await Promise.allSettled([
      readHostJobTemplates(hostId),
      readLocations({ page_size: 200, order_by: 'name' }),
    ]);
    const jts = jtRes.status === 'fulfilled' ? jtRes.value.data.results || [] : [];
    setJobTemplates(jts);
    setSelectedJT(jts[0]?.id ? String(jts[0].id) : '');
    setRunLocations(locRes.status === 'fulfilled' ? locRes.value.data.results || [] : []);
    setRunLocationId('');
    setRunLimit(host.name);
    setRunOpen(true);
  };

  const doRun = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { data } = await runHost(
        hostId, Number(selectedJT), runLimit, runLocationId || undefined
      );
      setRunOpen(false);
      setMsg(`Job #${data.job_id} started — limit: ${runLimit || host.name}`);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardBody>
        {/* Actions row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button variant="primary" onClick={openRun}>
            Run host
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setCloneName(`${host.name}-clone`); setCloneOpen(true); }}
          >
            Clone host
          </Button>
        </div>

        <Alert
          variant="info"
          isInline
          title="How variables work here"
          style={{ marginBottom: 12 }}
        >
          This tab is the main editor for this host&apos;s variables. Assigned roles
          contribute their <code>defaults/main.yml</code> values (scanned on project
          sync) as a baseline; editing a value writes an override into the host&apos;s
          native <code>host_vars</code>, and reset removes it again. Everything saved
          here lives in the same place Ansible reads.{' '}
          <Link to={`/hosts/${hostId}/edit`}>Edit raw YAML (advanced) →</Link>
        </Alert>

        {msg && <Alert variant="success" title={msg} isInline style={{ marginBottom: 8 }} />}
        {err && (
          <Alert variant="danger" title="Error" isInline style={{ marginBottom: 8 }}>
            <pre style={{ margin: 0 }}>{JSON.stringify(err, null, 2)}</pre>
          </Alert>
        )}

        {/* ── Assigned roles ── */}
        <Title headingLevel="h3" size="md" style={{ marginTop: 8 }}>
          Assigned roles
        </Title>
        {hostRoles.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {hostRoles.map((r) => (
              <Label
                key={r}
                color="blue"
                isCompact
                onClose={() => removeRole(r)}
              >
                {r}
              </Label>
            ))}
          </div>
        ) : (
          <p style={{ color: '#6a6e73' }}>No roles assigned yet.</p>
        )}

        {/* ── Add role ── */}
        <Title headingLevel="h3" size="md" style={{ marginTop: 20 }}>
          Add role
        </Title>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormGroup label="Project" fieldId="hrv-proj" style={{ minWidth: 220 }}>
            <FormSelect
              id="hrv-proj"
              value={projectId}
              onChange={(v) => setProjectId(v)}
            >
              <FormSelectOption value="" label="— select project —" />
              {projects.map((p) => (
                <FormSelectOption key={p.id} value={String(p.id)} label={p.name} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Search role" fieldId="hrv-search" style={{ minWidth: 260 }}>
            <SearchInput
              id="hrv-search"
              placeholder="Type to filter (min 2 chars)…"
              value={roleSearch}
              onChange={(_e, v) =>
                setRoleSearch(typeof v === 'string' ? v : _e?.target?.value ?? '')
              }
              onClear={() => setRoleSearch('')}
            />
          </FormGroup>
        </div>

        {availableRoles.length > 0 && (
          <div
            style={{
              marginTop: 8,
              maxHeight: 280,
              overflowY: 'auto',
              border: '1px solid #d2d2d2',
              borderRadius: 4,
            }}
          >
            <TableComposable variant="compact" aria-label="Available roles">
              <Thead>
                <Tr>
                  <Th>Role</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {filteredRoles.map((r) => (
                  <Tr key={r}>
                    <Td dataLabel="Role">{r}</Td>
                    <Td dataLabel="Add" modifier="fitContent">
                      <Button
                        variant="link"
                        isInline
                        isDisabled={busy}
                        onClick={() => addRole(r)}
                      >
                        Add
                      </Button>
                    </Td>
                  </Tr>
                ))}
                {filteredRoles.length === 0 && (
                  <Tr>
                    <Td colSpan={2} style={{ color: '#6a6e73' }}>
                      {roleSearch.length < 2
                        ? 'All available roles are already assigned.'
                        : `No roles matching "${roleSearch}".`}
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </TableComposable>
          </div>
        )}

        {/* ── Role variables ── */}
        <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
          Role variables
        </Title>
        <p style={{ color: '#6a6e73', marginBottom: 8 }}>
          Defaults from the assigned roles. Editing overrides the default (stored in
          host_vars); reset reverts to the role default.
        </p>
        {(() => {
          const rolesWithoutVars = hostRoles.filter(
            (r) => !hostVars.some((v) => v.role_name === r)
          );
          return rolesWithoutVars.length > 0 ? (
            <p style={{ color: '#6a6e73', fontSize: 13, margin: '4px 0 8px' }}>
              Roles with no variables: {rolesWithoutVars.join(', ')}
            </p>
          ) : null;
        })()}
        <TableComposable variant="compact" aria-label="Role variables">
          <Thead>
            <Tr>
              <Th>Role</Th>
              <Th>Variable</Th>
              <Th>Value</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>
          <Tbody>
            {hostVars.map((v) => (
              <Tr key={`${v.role_name}.${v.var_name}`}>
                <Td dataLabel="Role">{v.role_name}</Td>
                <Td dataLabel="Variable"><code>{v.var_name}</code></Td>
                <Td dataLabel="Value">
                  <code>
                    {(typeof v.value === 'string'
                      ? v.value
                      : JSON.stringify(v.value)
                    ).slice(0, 60)}
                  </code>
                </Td>
                <Td dataLabel="Status">
                  {v.is_overridden ? (
                    <Label color="orange" isCompact>overridden</Label>
                  ) : (
                    <Label color="grey" isCompact>default</Label>
                  )}
                </Td>
                <Td dataLabel="Action">
                  <Button variant="link" isInline onClick={() => openEdit(v)}>
                    edit
                  </Button>
                  {v.is_overridden && (
                    <>
                      {' '}
                      <Button variant="link" isInline onClick={() => resetVar(v)}>
                        reset
                      </Button>
                    </>
                  )}
                </Td>
              </Tr>
            ))}
            {hostVars.length === 0 && (
              <Tr>
                <Td colSpan={5} style={{ color: '#6a6e73' }}>
                  No role variables — assign a role above.
                </Td>
              </Tr>
            )}
          </Tbody>
        </TableComposable>

        {/* ── Other host variables (free host_vars) ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 24,
          }}
        >
          <Title headingLevel="h3" size="md">
            Other host variables (host_vars)
          </Title>
          <Button variant="secondary" isSmall onClick={openAddFreeVar}>
            Add variable
          </Button>
        </div>
        <p style={{ color: '#6a6e73', margin: '4px 0 8px' }}>
          Variables stored directly on this host that are not tied to a role (e.g.
          <code> criticality</code>, <code>docker</code>). For deeply nested structures,
          use <Link to={`/hosts/${hostId}/edit`}>raw YAML</Link>.
        </p>
        <TableComposable variant="compact" aria-label="Other host variables">
          <Thead>
            <Tr>
              <Th>Variable</Th>
              <Th>Value</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>
          <Tbody>
            {freeVars.map((v) => (
              <Tr key={v.var_name}>
                <Td dataLabel="Variable"><code>{v.var_name}</code></Td>
                <Td dataLabel="Value">
                  <code>
                    {(typeof v.value === 'string'
                      ? v.value
                      : JSON.stringify(v.value)
                    ).slice(0, 80)}
                  </code>
                </Td>
                <Td dataLabel="Action">
                  <Button variant="link" isInline onClick={() => openEdit({ ...v, isFree: true })}>
                    edit
                  </Button>{' '}
                  <Button variant="link" isInline onClick={() => resetVar(v)}>
                    remove
                  </Button>
                </Td>
              </Tr>
            ))}
            {freeVars.length === 0 && (
              <Tr>
                <Td colSpan={3} style={{ color: '#6a6e73' }}>
                  No extra host variables.
                </Td>
              </Tr>
            )}
          </Tbody>
        </TableComposable>
      </CardBody>

      {/* ── Run host modal ── */}
      {runOpen && (
        <Modal
          title={`Run host: ${host.name}`}
          isOpen
          variant="small"
          onClose={() => setRunOpen(false)}
          actions={[
            <Button key="run" variant="primary" onClick={doRun} isDisabled={!selectedJT || busy}>
              Launch
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>,
          ]}
        >
          <Form>
            <FormGroup label="Playbook / Template" isRequired fieldId="run-jt">
              <FormSelect
                id="run-jt"
                value={selectedJT}
                onChange={(v) => setSelectedJT(v)}
              >
                <FormSelectOption value="" label="— select —" />
                {jobTemplates.map((jt) => (
                  <FormSelectOption
                    key={jt.id}
                    value={String(jt.id)}
                    label={`${jt.playbook} (${jt.name})`}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup
              label="Limit"
              fieldId="run-limit"
              helperText="Host/group pattern passed to Ansible as --limit"
            >
              <TextInput
                id="run-limit"
                value={runLimit}
                onChange={(v) => setRunLimit(typeof v === 'string' ? v : v?.target?.value ?? '')}
              />
            </FormGroup>
            {runLocations.length > 0 && (
              <FormGroup
                label="Location / Runner"
                fieldId="run-location"
                helperText="Optional — leave empty to use any available runner"
              >
                <FormSelect
                  id="run-location"
                  value={runLocationId}
                  onChange={(v) => setRunLocationId(v)}
                >
                  <FormSelectOption value="" label="— any runner —" />
                  {runLocations.map((loc) => (
                    <FormSelectOption key={loc.id} value={String(loc.id)} label={loc.name} />
                  ))}
                </FormSelect>
              </FormGroup>
            )}
          </Form>
          {jobTemplates.length === 0 && (
            <Alert
              variant="warning"
              title="No job templates found for this host's inventory"
              isInline
              style={{ marginTop: 12 }}
            />
          )}
        </Modal>
      )}

      {/* ── Clone modal ── */}
      {cloneOpen && (
        <Modal
          title="Clone host"
          isOpen
          variant="small"
          onClose={() => setCloneOpen(false)}
          actions={[
            <Button key="clone" variant="primary" onClick={doClone} isDisabled={!cloneName || busy}>
              Clone
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setCloneOpen(false)}>
              Cancel
            </Button>,
          ]}
        >
          <Form>
            <FormGroup label="Name of the new host" isRequired fieldId="clone-name">
              <TextInput
                id="clone-name"
                value={cloneName}
                onChange={(v) => setCloneName(typeof v === 'string' ? v : v?.target?.value ?? '')}
              />
            </FormGroup>
            <FormGroup fieldId="clone-groups">
              <Checkbox
                id="clone-groups"
                label="Copy group memberships"
                isChecked={cloneGroups}
                onChange={(checked) => setCloneGroups(checked)}
              />
            </FormGroup>
            <p style={{ color: '#6a6e73' }}>
              Copies host_vars (incl. role variables) and optionally the groups.
            </p>
          </Form>
        </Modal>
      )}

      {/* ── Edit variable modal ── */}
      {editingVar && (
        <Modal
          title={
            editingVar.isNew
              ? 'Add host variable'
              : `${editingVar.role_name ? `${editingVar.role_name} › ` : ''}${editingVar.var_name}`
          }
          isOpen
          variant="large"
          onClose={() => setEditingVar(null)}
          actions={[
            <Button key="save" variant="primary" onClick={saveEdit} isDisabled={busy}>
              Save
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setEditingVar(null)}>
              Cancel
            </Button>,
          ]}
        >
          {editingVar.isNew && (
            <FormGroup label="Variable name" isRequired fieldId="newvar-name" style={{ marginBottom: 8 }}>
              <TextInput
                id="newvar-name"
                value={editName}
                onChange={(v) => setEditName(typeof v === 'string' ? v : v?.target?.value ?? '')}
                placeholder="e.g. criticality"
              />
            </FormGroup>
          )}
          {editingVar.default_value !== undefined && (
            <p style={{ marginBottom: 8 }}>
              Role default:{' '}
              <code>
                {typeof editingVar.default_value === 'string'
                  ? editingVar.default_value
                  : JSON.stringify(editingVar.default_value)}
              </code>
            </p>
          )}
          <TextArea
            aria-label="Variable value"
            value={editText}
            onChange={(v) => setEditText(typeof v === 'string' ? v : v?.target?.value ?? '')}
            rows={20}
            resizeOrientation="vertical"
            style={{ fontFamily: 'monospace' }}
          />
          <p style={{ marginTop: 8, color: '#6a6e73' }}>
            JSON is parsed; invalid JSON is stored as a raw string.
          </p>
        </Modal>
      )}
    </Card>
  );
}

HostRoleVariables.propTypes = {
  host: object.isRequired,
};

export default HostRoleVariables;
