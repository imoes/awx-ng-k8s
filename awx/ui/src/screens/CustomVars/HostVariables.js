/* eslint-disable i18next/no-literal-string */
// awx-ng: per-host role variable management.
// Assign roles → variables get materialized → editable per host (large field).
// Plus host cloning for standardized hosts.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  PageSection,
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
import { CaretLeftIcon } from '@patternfly/react-icons';
import {
  TableComposable,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from '@patternfly/react-table';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import useRequest from 'hooks/useRequest';
import {
  LocationsAPI,
  readProjects,
  readProjectRoleVariables,
  readHostRoleVariables,
  patchHostRoleVariable,
  resetHostRoleVariable,
  assignHostRoles,
  cloneHost,
} from './api';

function HostVariables() {
  const { id: hostId } = useParams();
  const [hostName, setHostName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [hostVars, setHostVars] = useState([]);
  const [editingVar, setEditingVar] = useState(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneGroups, setCloneGroups] = useState(true);

  const { request: fetchBase } = useRequest(
    useCallback(async () => {
      const [host, projs] = await Promise.all([
        LocationsAPI.http.get(`/api/v2/hosts/${hostId}/`),
        readProjects({ page_size: 200, order_by: 'name' }),
      ]);
      setHostName(host.data.name);
      setProjects(projs.data.results);
      return null;
    }, [hostId]),
    null
  );
  useEffect(() => {
    fetchBase();
  }, [fetchBase]);

  const loadHostVars = useCallback(async () => {
    const { data } = await readHostRoleVariables(hostId, { page_size: 500 });
    setHostVars(data.results);
  }, [hostId]);

  useEffect(() => {
    loadHostVars();
  }, [loadHostVars]);

  useEffect(() => {
    if (!projectId) {
      setAvailableRoles([]);
      return;
    }
    (async () => {
      const { data } = await readProjectRoleVariables(projectId, {
        page_size: 1000,
      });
      const roles = Array.from(
        new Set(data.results.map((rv) => rv.role_name))
      ).sort();
      setAvailableRoles(roles);
    })();
  }, [projectId]);

  const toggleRole = (role) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const doAssign = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const current = Array.from(new Set(hostVars.map((v) => v.role_name)));
      const roles = Array.from(new Set([...current, ...selectedRoles]));
      const { data } = await assignHostRoles(hostId, roles, Number(projectId));
      setMsg(
        `${data.variables_materialized} variables materialized for roles: ${roles.join(', ')}`
      );
      setSelectedRoles([]);
      loadHostVars();
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
      await patchHostRoleVariable(hostId, editingVar.id, parsed);
      setEditingVar(null);
      loadHostVars();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const resetVar = async (v) => {
    await resetHostRoleVariable(hostId, v.id);
    loadHostVars();
  };

  const doClone = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { data } = await cloneHost(hostId, cloneName, cloneGroups);
      setCloneOpen(false);
      setCloneName('');
      setMsg(
        `Host '${data.name}' cloned (${data.role_variables_copied} variables, ${data.groups_copied} groups). Open it from the host list.`
      );
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const assignedRoles = Array.from(new Set(hostVars.map((v) => v.role_name)));

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{
          '/host_variables': 'Host Variables',
          [`/host_variables/${hostId}`]: hostName || hostId,
        }}
      />
      <PageSection>
        <Card>
          <CardBody>
            <div style={{ marginBottom: 16 }}>
              <Link to="/host_variables">
                <CaretLeftIcon /> Back to hosts
              </Link>
            </div>
            <Title headingLevel="h2" size="lg">
              {hostName}
              <Button
                variant="secondary"
                style={{ marginLeft: 16 }}
                onClick={() => {
                  setCloneName(hostName ? `${hostName}-clone` : '');
                  setCloneOpen(true);
                }}
              >
                Clone host
              </Button>
            </Title>

            {msg && (
              <Alert variant="success" title={msg} isInline style={{ marginTop: 12 }} />
            )}
            {err && (
              <Alert variant="danger" title="Error" isInline style={{ marginTop: 12 }}>
                <pre>{JSON.stringify(err, null, 2)}</pre>
              </Alert>
            )}

            <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
              Assigned roles
            </Title>
            {assignedRoles.length ? (
              <ChipGroup>
                {assignedRoles.map((r) => (
                  <Chip key={r} isReadOnly>
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
            <FormGroup label="Project" fieldId="hv-proj">
              <FormSelect
                id="hv-proj"
                value={projectId}
                onChange={(v) => setProjectId(v)}
                style={{ maxWidth: 400 }}
              >
                <FormSelectOption value="" label="— select project —" />
                {projects.map((p) => (
                  <FormSelectOption
                    key={p.id}
                    value={String(p.id)}
                    label={p.name}
                  />
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
              Role variables for this host
            </Title>
            <TableComposable variant="compact" aria-label="Host variables">
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
                  <Tr key={v.id}>
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
                          <Button
                            variant="link"
                            isInline
                            onClick={() => resetVar(v)}
                          >
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
        </Card>
      </PageSection>

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
              Copies host_vars, all role variable overrides and (optionally) the
              groups. You can then adjust the clone&apos;s variables.
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
    </>
  );
}

export default HostVariables;
