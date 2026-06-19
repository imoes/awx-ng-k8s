/* eslint-disable i18next/no-literal-string */
// awx-ng: "Role Variables" tab on the host page.
// Single source of truth = native host.variables. Role defaults come from the
// project scan; a variable counts as "overridden" when it is set in host_vars.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Modal,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
  TextArea,
  Checkbox,
  Alert,
  Label,
  Title,
  Chip,
  ChipGroup,
} from '@patternfly/react-core';
import {
  TableComposable,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from '@patternfly/react-table';
import { object } from 'prop-types';
import {
  readProjects,
  readProjectRoleVariables,
  readHostRoleVariables,
  patchHostRoleVariable,
  resetHostRoleVariable,
  assignHostRoles,
  cloneHost,
} from 'screens/CustomVars/api';

function HostRoleVariables({ host }) {
  const hostId = host.id;
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [hostRoles, setHostRoles] = useState([]);
  const [hostVars, setHostVars] = useState([]);
  const [editingVar, setEditingVar] = useState(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneGroups, setCloneGroups] = useState(true);

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
    if (!projectId) {
      setAvailableRoles([]);
      return;
    }
    readProjectRoleVariables(projectId, { page_size: 1000 }).then(({ data }) => {
      const roles = Array.from(
        new Set(data.results.map((rv) => rv.role_name))
      ).sort();
      setAvailableRoles(roles);
    });
  }, [projectId]);

  const toggleRole = (role) =>
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );

  const doAssign = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const roles = Array.from(new Set([...hostRoles, ...selectedRoles]));
      await assignHostRoles(hostId, roles);
      setMsg(`Assigned roles: ${roles.join(', ')}`);
      setSelectedRoles([]);
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
      await assignHostRoles(
        hostId,
        hostRoles.filter((r) => r !== role)
      );
      loadVars();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

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
      try {
        parsed = JSON.parse(editText);
      } catch {
        parsed = editText;
      }
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

  const doClone = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { data } = await cloneHost(hostId, cloneName, cloneGroups);
      setCloneOpen(false);
      setCloneName('');
      setMsg(`Host '${data.name}' cloned (${data.groups_copied} groups).`);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardBody>
        <div style={{ marginBottom: 12 }}>
          <Button
            variant="secondary"
            onClick={() => {
              setCloneName(`${host.name}-clone`);
              setCloneOpen(true);
            }}
          >
            Clone host
          </Button>
        </div>

        {msg && <Alert variant="success" title={msg} isInline />}
        {err && (
          <Alert variant="danger" title="Error" isInline>
            <pre>{JSON.stringify(err, null, 2)}</pre>
          </Alert>
        )}

        <Title headingLevel="h3" size="md" style={{ marginTop: 16 }}>
          Assigned roles
        </Title>
        {hostRoles.length ? (
          <ChipGroup>
            {hostRoles.map((r) => (
              <Chip key={r} onClick={() => removeRole(r)}>
                {r}
              </Chip>
            ))}
          </ChipGroup>
        ) : (
          <p>No roles assigned yet.</p>
        )}

        <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
          Assign roles
        </Title>
        <FormGroup label="Project" fieldId="hrv-proj">
          <FormSelect
            id="hrv-proj"
            value={projectId}
            onChange={(v) => setProjectId(v)}
            style={{ maxWidth: 400 }}
          >
            <FormSelectOption value="" label="— select project —" />
            {projects.map((p) => (
              <FormSelectOption key={p.id} value={String(p.id)} label={p.name} />
            ))}
          </FormSelect>
        </FormGroup>
        {availableRoles.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {availableRoles.map((r) => (
              <Label
                key={r}
                color={selectedRoles.includes(r) ? 'blue' : 'grey'}
                onClick={() => toggleRole(r)}
                style={{ cursor: 'pointer', margin: 2 }}
              >
                {r}
              </Label>
            ))}
            <div style={{ marginTop: 12 }}>
              <Button
                variant="primary"
                onClick={doAssign}
                isDisabled={busy || selectedRoles.length === 0}
              >
                Assign {selectedRoles.length} role(s)
              </Button>
            </div>
          </div>
        )}

        <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
          Role variables
        </Title>
        <p style={{ color: '#6a6e73', marginBottom: 8 }}>
          Values are stored in this host&apos;s variables (host_vars). Editing a
          value overrides the role default; reset removes it again.
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
                <Td dataLabel="Variable">{v.var_name}</Td>
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
                    <Label color="orange" isCompact>
                      overridden
                    </Label>
                  ) : (
                    <Label color="grey" isCompact>
                      default
                    </Label>
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

      {cloneOpen && (
        <Modal
          title="Clone host"
          isOpen
          variant="small"
          onClose={() => setCloneOpen(false)}
          actions={[
            <Button
              key="clone"
              variant="primary"
              onClick={doClone}
              isDisabled={!cloneName || busy}
            >
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

      {editingVar && (
        <Modal
          title={`${editingVar.role_name}.${editingVar.var_name}`}
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
