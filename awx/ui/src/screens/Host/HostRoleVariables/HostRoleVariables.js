/* eslint-disable i18next/no-literal-string */
// awx-ng: "Role Variables" tab on the host page.
// Single source of truth = native host.variables. Role defaults come from the
// project scan; a variable counts as "overridden" when it is set in host_vars.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { object } from 'prop-types';
import {
  assignHostRoles,
  cloneHost,
  patchHostRoleVariable,
  readHostJobTemplates,
  readHostRoleVariables,
  readProjectRoleVariables,
  readProjects,
  resetHostRoleVariable,
  runHost,
} from 'screens/CustomVars/api';

function HostRoleVariables({ host }) {
  const hostId = host.id;

  // Project + available roles
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [roleSearch, setRoleSearch] = useState('');

  // Assigned roles + variable overrides
  const [hostRoles, setHostRoles] = useState([]);
  const [hostVars, setHostVars] = useState([]);

  // Edit / reset variable
  const [editingVar, setEditingVar] = useState(null);
  const [editText, setEditText] = useState('');

  // Clone
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneGroups, setCloneGroups] = useState(true);

  // Run host
  const [runOpen, setRunOpen] = useState(false);
  const [jobTemplates, setJobTemplates] = useState([]);
  const [selectedJT, setSelectedJT] = useState('');

  // UI state
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadVars = useCallback(async () => {
    const { data } = await readHostRoleVariables(hostId);
    setHostVars(data.results);
    setHostRoles(data.host_roles || []);
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
    readProjectRoleVariables(projectId, { page_size: 1000 }).then(({ data }) => {
      const roles = Array.from(new Set(data.results.map((rv) => rv.role_name))).sort();
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
  const openEdit = (v) => {
    setEditingVar(v);
    setEditText(
      typeof v.value === 'string' ? v.value : JSON.stringify(v.value, null, 2)
    );
    setErr(null);
  };

  const saveEdit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let parsed;
      try { parsed = JSON.parse(editText); } catch { parsed = editText; }
      await patchHostRoleVariable(hostId, editingVar.var_name, parsed);
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
    try {
      const { data } = await readHostJobTemplates(hostId);
      setJobTemplates(data.results || []);
      setSelectedJT(data.results?.[0]?.id ? String(data.results[0].id) : '');
    } catch {
      setJobTemplates([]);
    }
    setRunOpen(true);
  };

  const doRun = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { data } = await runHost(hostId, Number(selectedJT));
      setRunOpen(false);
      setMsg(`Job #${data.job_id} started — limit: ${host.name}`);
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
          Values are stored in this host&apos;s variables (host_vars). Editing overrides the
          role default; reset removes it again.
        </p>
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
          <p style={{ marginBottom: 12 }}>
            Launches the selected Job Template with <code>--limit {host.name}</code>.
          </p>
          <Form>
            <FormGroup label="Job Template" isRequired fieldId="run-jt">
              <FormSelect
                id="run-jt"
                value={selectedJT}
                onChange={(v) => setSelectedJT(v)}
              >
                <FormSelectOption value="" label="— select template —" />
                {jobTemplates.map((jt) => (
                  <FormSelectOption
                    key={jt.id}
                    value={String(jt.id)}
                    label={`${jt.name} (${jt.playbook})`}
                  />
                ))}
              </FormSelect>
            </FormGroup>
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
                onChange={(v) => setCloneName(v)}
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
          title={`${editingVar.role_name} › ${editingVar.var_name}`}
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
          <p style={{ marginBottom: 8 }}>
            Role default:{' '}
            <code>
              {typeof editingVar.default_value === 'string'
                ? editingVar.default_value
                : JSON.stringify(editingVar.default_value)}
            </code>
          </p>
          <TextArea
            aria-label="Variable value"
            value={editText}
            onChange={(v) => setEditText(v)}
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
