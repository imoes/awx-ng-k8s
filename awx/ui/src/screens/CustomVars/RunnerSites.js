/* eslint-disable i18next/no-literal-string */
// awx-ng: Runner management — register execution nodes, download install bundles,
// run health checks, deprovision, and assign each runner to a site with
// site-specific ssh_user, ssh credential and ansible.cfg.
import React, { useCallback, useEffect, useState } from 'react';
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
  Alert,
  Spinner,
  Label,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import {
  TableComposable,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from '@patternfly/react-table';
import { formatDateString } from 'util/dates';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import useRequest from 'hooks/useRequest';
import {
  ExecNodeLocationsAPI,
  LocationsAPI,
  readInstances,
  upsertExecNodeLocation,
  registerRunner,
  triggerInstanceHealthCheck,
  deprovisionRunner,
  listMachineCredentials,
} from './api';

const STATE_COLORS = {
  ready: 'green',
  installed: 'blue',
  provisioning: 'orange',
  'provision-fail': 'red',
  unavailable: 'red',
  deprovisioning: 'grey',
  'deprovision-fail': 'red',
};

function RunnerSites() {
  const [editing, setEditing] = useState(null); // { instance, assignment, form }
  const [registering, setRegistering] = useState(null); // register form or null
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [hcPending, setHcPending] = useState({}); // instanceId → true while running

  const {
    result: { instances, assignments, locations, credentials },
    isLoading,
    error,
    request: fetchAll,
  } = useRequest(
    useCallback(async () => {
      const [i, a, l, c] = await Promise.all([
        readInstances({ page_size: 200 }),
        ExecNodeLocationsAPI.read({ page_size: 200 }),
        LocationsAPI.read({ page_size: 1000 }),
        listMachineCredentials(),
      ]);
      return {
        instances: i.data.results,
        assignments: a.data.results,
        locations: l.data.results,
        credentials: c.data.results,
      };
    }, []),
    { instances: [], assignments: [], locations: [], credentials: [] }
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const assignmentFor = (hostname) =>
    assignments.find((a) => a.instance_hostname === hostname) || null;

  // ── Site assignment ─────────────────────────────────────────────────────────
  const openEdit = (instance) => {
    const a = assignmentFor(instance.hostname);
    setEditing({
      instance,
      assignment: a,
      form: {
        location: a?.location || '',
        ssh_user: a?.ssh_user || '',
        ssh_credential_id: a?.ssh_credential_id ?? '',
        ansible_cfg: a?.ansible_cfg || '',
      },
    });
    setActionError(null);
  };

  const upd = (field) => (v) =>
    setEditing((p) => ({ ...p, form: { ...p.form, [field]: v } }));

  const save = async () => {
    setBusy(true);
    setActionError(null);
    const { instance, assignment, form } = editing;
    const payload = {
      instance_hostname: instance.hostname,
      location: form.location || null,
      ssh_user: form.ssh_user,
      ssh_credential_id: form.ssh_credential_id
        ? Number(form.ssh_credential_id)
        : null,
      ansible_cfg: form.ansible_cfg,
    };
    try {
      await upsertExecNodeLocation(assignment, payload);
      setEditing(null);
      fetchAll();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Register runner ───────────────────────────────────────────────────────
  const openRegister = () => {
    setRegistering({ hostname: '', node_type: 'execution' });
    setActionError(null);
  };

  const updReg = (field) => (v) =>
    setRegistering((p) => ({ ...p, [field]: v }));

  const doRegister = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await registerRunner(registering.hostname, registering.node_type);
      setRegistering(null);
      fetchAll();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Health check + deprovision ──────────────────────────────────────────────
  const runHealthCheck = async (inst) => {
    setHcPending((p) => ({ ...p, [inst.id]: true }));
    setActionError(null);
    try {
      await triggerInstanceHealthCheck(inst.id);
      // Health check is async — refetch after a short delay to pick up the result
      setTimeout(async () => {
        await fetchAll();
        setHcPending((p) => ({ ...p, [inst.id]: false }));
      }, 3000);
    } catch (e) {
      setActionError(e?.response?.data || e.message);
      setHcPending((p) => ({ ...p, [inst.id]: false }));
    }
  };

  const doDeprovision = async (inst) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Deprovision runner "${inst.hostname}"?`)) return;
    setActionError(null);
    try {
      await deprovisionRunner(inst.hostname);
      fetchAll();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    }
  };

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{ '/runner_sites': 'Runners' }}
      />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <Button variant="primary" onClick={openRegister}>
                    Register runner
                  </Button>
                </ToolbarItem>
                <ToolbarItem>
                  <Button variant="secondary" onClick={fetchAll} isDisabled={isLoading}>
                    Refresh
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {actionError && (
              <Alert variant="danger" title="Error" isInline style={{ marginBottom: 8 }}>
                <pre>{JSON.stringify(actionError, null, 2)}</pre>
              </Alert>
            )}

            {isLoading ? (
              <Spinner />
            ) : error ? (
              <Alert variant="danger" title="Failed to load" isInline />
            ) : (
              <TableComposable variant="compact" aria-label="Runners">
                <Thead>
                  <Tr>
                    <Th>Runner (instance)</Th>
                    <Th>Node type</Th>
                    <Th>State</Th>
                    <Th>Capacity</Th>
                    <Th>Last health check</Th>
                    <Th>Site</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {instances.map((inst) => {
                    const a = assignmentFor(inst.hostname);
                    const isExec =
                      inst.node_type === 'execution' || inst.node_type === 'hop';
                    const canManage = isExec && !inst.managed;
                    const pending = hcPending[inst.id] || inst.health_check_pending;
                    return (
                      <Tr key={inst.id || inst.hostname}>
                        <Td dataLabel="Runner">{inst.hostname}</Td>
                        <Td dataLabel="Node type">
                          <Label isCompact>{inst.node_type}</Label>
                          {inst.managed && (
                            <Label isCompact color="grey" style={{ marginLeft: 4 }}>
                              managed
                            </Label>
                          )}
                        </Td>
                        <Td dataLabel="State">
                          <Label isCompact color={STATE_COLORS[inst.node_state] || 'grey'}>
                            {inst.node_state}
                          </Label>
                        </Td>
                        <Td dataLabel="Capacity">
                          {inst.capacity > 0 ? inst.capacity : '—'}
                        </Td>
                        <Td dataLabel="Last health check">
                          {inst.errors ? (
                            <Tooltip content={inst.errors}>
                              <Label isCompact color="red">error</Label>
                            </Tooltip>
                          ) : inst.last_health_check ? (
                            formatDateString(inst.last_health_check)
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td dataLabel="Site">{a?.location_name || '—'}</Td>
                        <Td dataLabel="Actions">
                          <Button
                            variant="link"
                            isInline
                            onClick={() => openEdit(inst)}
                          >
                            {a ? 'edit site' : 'assign site'}
                          </Button>
                          {canManage ? (
                            <>
                              {' · '}
                              <Button
                                variant="link"
                                isInline
                                isLoading={pending}
                                isDisabled={pending}
                                onClick={() => runHealthCheck(inst)}
                              >
                                {pending ? 'checking…' : 'health check'}
                              </Button>
                              {' · '}
                              <Tooltip
                                content={`Install Receptor on the host (node id "${inst.hostname}"), dialing out to the control node on port 2222 — see deploy/PROXIES.md`}
                              >
                                <span style={{ color: '#6a6e73' }}>setup ⓘ</span>
                              </Tooltip>
                              {' · '}
                              <Button
                                variant="link"
                                isInline
                                isDanger
                                onClick={() => doDeprovision(inst)}
                              >
                                deprovision
                              </Button>
                            </>
                          ) : (
                            <Tooltip content="Managed hybrid/control node — health check & remote setup not applicable">
                              <span style={{ color: '#6a6e73', marginLeft: 8 }}>
                                (managed)
                              </span>
                            </Tooltip>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </TableComposable>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {/* ── Register runner modal ── */}
      {registering && (
        <Modal
          title="Register runner (execution node)"
          isOpen
          variant="medium"
          onClose={() => setRegistering(null)}
          actions={[
            <Button
              key="register"
              variant="primary"
              onClick={doRegister}
              isDisabled={busy || !registering.hostname}
            >
              Register
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setRegistering(null)}>
              Cancel
            </Button>,
          ]}
        >
          {actionError && (
            <Alert variant="danger" title="Error" isInline style={{ marginBottom: 8 }}>
              <pre>{JSON.stringify(actionError, null, 2)}</pre>
            </Alert>
          )}
          <Form>
            <FormGroup
              label="Hostname"
              isRequired
              fieldId="reg-hostname"
              helperText="Must match the Receptor node id configured on the remote host (e.g. ansible03)"
            >
              <TextInput
                id="reg-hostname"
                value={registering.hostname}
                onChange={updReg('hostname')}
              />
            </FormGroup>
            <FormGroup label="Node type" fieldId="reg-type">
              <FormSelect
                id="reg-type"
                value={registering.node_type}
                onChange={updReg('node_type')}
              >
                <FormSelectOption value="execution" label="execution" />
                <FormSelectOption value="hop" label="hop" />
              </FormSelect>
            </FormGroup>
            <Alert
              variant="info"
              isInline
              isPlain
              title="After registering, install Receptor + ansible-runner on the host (dialing out to the control node on port 2222). See deploy/PROXIES.md. Capacity appears once the mesh link is up."
            />
          </Form>
        </Modal>
      )}

      {/* ── Site assignment modal ── */}
      {editing && (
        <Modal
          title={`Assign site — ${editing.instance.hostname}`}
          isOpen
          variant="medium"
          onClose={() => setEditing(null)}
          actions={[
            <Button key="save" variant="primary" onClick={save} isDisabled={busy}>
              Save
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setEditing(null)}>
              Cancel
            </Button>,
          ]}
        >
          {actionError && (
            <Alert variant="danger" title="Error" isInline>
              <pre>{JSON.stringify(actionError, null, 2)}</pre>
            </Alert>
          )}
          <Form>
            <FormGroup label="Site" fieldId="rs-loc">
              <FormSelect
                id="rs-loc"
                value={editing.form.location}
                onChange={upd('location')}
              >
                <FormSelectOption value="" label="— none —" />
                {locations.map((l) => (
                  <FormSelectOption key={l.id} value={l.id} label={l.name} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="SSH user" fieldId="rs-user">
              <TextInput
                id="rs-user"
                value={editing.form.ssh_user}
                onChange={upd('ssh_user')}
              />
            </FormGroup>
            <FormGroup
              label="Machine credential"
              fieldId="rs-cred"
              helperText="Used when the job template has no machine credential of its own (template wins)."
            >
              <FormSelect
                id="rs-cred"
                value={editing.form.ssh_credential_id}
                onChange={upd('ssh_credential_id')}
              >
                <FormSelectOption value="" label="— none —" />
                {credentials.map((c) => (
                  <FormSelectOption
                    key={c.id}
                    value={c.id}
                    label={`${c.name} (#${c.id})`}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="ansible.cfg (for this site)" fieldId="rs-cfg">
              <TextArea
                id="rs-cfg"
                value={editing.form.ansible_cfg}
                onChange={upd('ansible_cfg')}
                rows={12}
                resizeOrientation="vertical"
              />
            </FormGroup>
          </Form>
        </Modal>
      )}
    </>
  );
}

export default RunnerSites;
