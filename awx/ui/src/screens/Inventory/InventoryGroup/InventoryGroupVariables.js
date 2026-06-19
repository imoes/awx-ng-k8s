/* eslint-disable i18next/no-literal-string */
// awx-ng: structured "Variables" tab for an inventory group (group_vars).
// Single source of truth = native Group.variables. Mirrors the host Role Variables
// tab: assigned roles contribute defaults/main.yml as a baseline, overrides are
// stored in group_vars; free group_vars are editable here too.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
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
import { GroupsAPI } from 'api';
import {
  assignGroupRoles,
  patchGroupRoleVariable,
  readGroupRoleVariables,
  readProjectRoles,
  readProjects,
  resetGroupRoleVariable,
} from 'screens/CustomVars/api';

const CONTROL_KEYS = new Set(['host_roles']);

function InventoryGroupVariables({ inventoryGroup }) {
  const groupId = inventoryGroup.id;

  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [roleSearch, setRoleSearch] = useState('');

  const [groupRoles, setGroupRoles] = useState([]);
  const [groupVars, setGroupVars] = useState([]);
  const [rawVars, setRawVars] = useState('');

  const [editingVar, setEditingVar] = useState(null);
  const [editName, setEditName] = useState('');
  const [editText, setEditText] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const loadVars = useCallback(async () => {
    const [{ data }, detail] = await Promise.all([
      readGroupRoleVariables(groupId),
      GroupsAPI.readDetail(groupId),
    ]);
    setGroupVars(data.results);
    setGroupRoles(data.host_roles || []);
    setRawVars(detail?.data?.variables || '');
    if (data.project_id && !projectId) setProjectId(String(data.project_id));
  }, [groupId, projectId]);

  useEffect(() => {
    loadVars();
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) =>
      setProjects(data.results)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    if (!projectId) { setAvailableRoles([]); return; }
    readProjectRoles(projectId).then(({ data }) => {
      setAvailableRoles((data.results || []).map((r) => r.role_name).sort());
    });
  }, [projectId]);

  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    const notAssigned = availableRoles.filter((r) => !groupRoles.includes(r));
    if (q.length < 2) return notAssigned;
    return notAssigned.filter((r) => r.toLowerCase().includes(q));
  }, [availableRoles, groupRoles, roleSearch]);

  const freeVars = useMemo(() => {
    let parsed = {};
    try { parsed = yaml.load(rawVars) || {}; } catch { parsed = {}; }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const roleVarNames = new Set(groupVars.map((v) => v.var_name));
    return Object.keys(parsed)
      .filter((k) => !CONTROL_KEYS.has(k) && !roleVarNames.has(k))
      .sort()
      .map((k) => ({ var_name: k, value: parsed[k] }));
  }, [rawVars, groupVars]);

  const wrap = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); loadVars(); }
    catch (e) { setErr(e?.response?.data || e.message); }
    finally { setBusy(false); }
  };

  const addRole = (role) =>
    wrap(async () => { await assignGroupRoles(groupId, [...groupRoles, role]); setRoleSearch(''); });
  const removeRole = (role) =>
    wrap(() => assignGroupRoles(groupId, groupRoles.filter((r) => r !== role)));
  const resetVar = (v) => wrap(() => resetGroupRoleVariable(groupId, v.var_name));

  const stringify = (val) =>
    typeof val === 'string' ? val : JSON.stringify(val, null, 2);

  const openEdit = (v) => {
    setEditingVar(v); setEditName(v.var_name); setEditText(stringify(v.value)); setErr(null);
  };
  const openAddFreeVar = () => {
    setEditingVar({ var_name: '', value: '', isFree: true, isNew: true });
    setEditName(''); setEditText(''); setErr(null);
  };
  const saveEdit = () =>
    wrap(async () => {
      const name = editingVar.isNew ? editName.trim() : editingVar.var_name;
      if (!name) throw new Error('Variable name required.');
      let parsed;
      try { parsed = JSON.parse(editText); } catch { parsed = editText; }
      await patchGroupRoleVariable(groupId, name, parsed);
      setEditingVar(null);
    });

  return (
    <Card>
      <CardBody>
        <Alert variant="info" isInline title="Group variables (group_vars)" style={{ marginBottom: 12 }}>
          Variables set here are stored on the group and apply to all member hosts.
          Precedence is role defaults &lt; group_vars &lt; host_vars — a host can still
          override any of these.
        </Alert>
        {err && (
          <Alert variant="danger" title="Error" isInline style={{ marginBottom: 8 }}>
            <pre style={{ margin: 0 }}>{JSON.stringify(err, null, 2)}</pre>
          </Alert>
        )}

        <Title headingLevel="h3" size="md">Assigned roles</Title>
        {groupRoles.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {groupRoles.map((r) => (
              <Label key={r} color="blue" isCompact onClose={() => removeRole(r)}>{r}</Label>
            ))}
          </div>
        ) : (
          <p style={{ color: '#6a6e73' }}>No roles assigned to this group.</p>
        )}

        <Title headingLevel="h3" size="md" style={{ marginTop: 20 }}>Add role</Title>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormGroup label="Project" fieldId="grv-proj" style={{ minWidth: 220 }}>
            <FormSelect id="grv-proj" value={projectId} onChange={(v) => setProjectId(v)}>
              <FormSelectOption value="" label="— select project —" />
              {projects.map((p) => (
                <FormSelectOption key={p.id} value={String(p.id)} label={p.name} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Search role" fieldId="grv-search" style={{ minWidth: 260 }}>
            <SearchInput
              id="grv-search"
              placeholder="Type to filter (min 2 chars)…"
              value={roleSearch}
              onChange={(_e, v) => setRoleSearch(typeof v === 'string' ? v : _e?.target?.value ?? '')}
              onClear={() => setRoleSearch('')}
            />
          </FormGroup>
        </div>
        {availableRoles.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto', border: '1px solid #d2d2d2', borderRadius: 4 }}>
            <TableComposable variant="compact" aria-label="Available roles">
              <Thead><Tr><Th>Role</Th><Th /></Tr></Thead>
              <Tbody>
                {filteredRoles.map((r) => (
                  <Tr key={r}>
                    <Td dataLabel="Role">{r}</Td>
                    <Td dataLabel="Add" modifier="fitContent">
                      <Button variant="link" isInline isDisabled={busy} onClick={() => addRole(r)}>Add</Button>
                    </Td>
                  </Tr>
                ))}
                {filteredRoles.length === 0 && (
                  <Tr><Td colSpan={2} style={{ color: '#6a6e73' }}>
                    {roleSearch.length < 2 ? 'All available roles are already assigned.' : `No roles matching "${roleSearch}".`}
                  </Td></Tr>
                )}
              </Tbody>
            </TableComposable>
          </div>
        )}

        <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>Role variables</Title>
        <TableComposable variant="compact" aria-label="Role variables">
          <Thead><Tr><Th>Role</Th><Th>Variable</Th><Th>Value</Th><Th>Status</Th><Th>Action</Th></Tr></Thead>
          <Tbody>
            {groupVars.map((v) => (
              <Tr key={`${v.role_name}.${v.var_name}`}>
                <Td dataLabel="Role">{v.role_name}</Td>
                <Td dataLabel="Variable"><code>{v.var_name}</code></Td>
                <Td dataLabel="Value">
                  <code>{(typeof v.value === 'string' ? v.value : JSON.stringify(v.value)).slice(0, 60)}</code>
                </Td>
                <Td dataLabel="Status">
                  {v.is_overridden ? <Label color="orange" isCompact>overridden</Label> : <Label color="grey" isCompact>default</Label>}
                </Td>
                <Td dataLabel="Action">
                  <Button variant="link" isInline onClick={() => openEdit(v)}>edit</Button>
                  {v.is_overridden && <>{' '}<Button variant="link" isInline onClick={() => resetVar(v)}>reset</Button></>}
                </Td>
              </Tr>
            ))}
            {groupVars.length === 0 && (
              <Tr><Td colSpan={5} style={{ color: '#6a6e73' }}>No role variables — assign a role above.</Td></Tr>
            )}
          </Tbody>
        </TableComposable>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <Title headingLevel="h3" size="md">Other group variables</Title>
          <Button variant="secondary" isSmall onClick={openAddFreeVar}>Add variable</Button>
        </div>
        <TableComposable variant="compact" aria-label="Other group variables">
          <Thead><Tr><Th>Variable</Th><Th>Value</Th><Th>Action</Th></Tr></Thead>
          <Tbody>
            {freeVars.map((v) => (
              <Tr key={v.var_name}>
                <Td dataLabel="Variable"><code>{v.var_name}</code></Td>
                <Td dataLabel="Value">
                  <code>{(typeof v.value === 'string' ? v.value : JSON.stringify(v.value)).slice(0, 80)}</code>
                </Td>
                <Td dataLabel="Action">
                  <Button variant="link" isInline onClick={() => openEdit({ ...v, isFree: true })}>edit</Button>{' '}
                  <Button variant="link" isInline onClick={() => resetVar(v)}>remove</Button>
                </Td>
              </Tr>
            ))}
            {freeVars.length === 0 && (
              <Tr><Td colSpan={3} style={{ color: '#6a6e73' }}>No extra group variables.</Td></Tr>
            )}
          </Tbody>
        </TableComposable>
      </CardBody>

      {editingVar && (
        <Modal
          title={editingVar.isNew ? 'Add group variable' : `${editingVar.role_name ? `${editingVar.role_name} › ` : ''}${editingVar.var_name}`}
          isOpen
          variant="large"
          onClose={() => setEditingVar(null)}
          actions={[
            <Button key="save" variant="primary" onClick={saveEdit} isDisabled={busy}>Save</Button>,
            <Button key="cancel" variant="link" onClick={() => setEditingVar(null)}>Cancel</Button>,
          ]}
        >
          {editingVar.isNew && (
            <FormGroup label="Variable name" isRequired fieldId="g-newvar-name" style={{ marginBottom: 8 }}>
              <TextInput
                id="g-newvar-name"
                value={editName}
                onChange={(v) => setEditName(typeof v === 'string' ? v : v?.target?.value ?? '')}
              />
            </FormGroup>
          )}
          {editingVar.default_value !== undefined && (
            <p style={{ marginBottom: 8 }}>
              Role default:{' '}
              <code>{typeof editingVar.default_value === 'string' ? editingVar.default_value : JSON.stringify(editingVar.default_value)}</code>
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
          <p style={{ marginTop: 8, color: '#6a6e73' }}>JSON is parsed; invalid JSON is stored as a raw string.</p>
        </Modal>
      )}
    </Card>
  );
}

InventoryGroupVariables.propTypes = {
  inventoryGroup: object.isRequired,
};

export default InventoryGroupVariables;
