/* eslint-disable i18next/no-literal-string */
// awx-ng: assign existing AWX instances (runners / execution nodes) to a site,
// with site-specific ssh_user, ssh credential and ansible.cfg.
// Runners are NOT created here — they are registered by AWX itself.
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
} from '@patternfly/react-core';
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
  ExecNodeLocationsAPI,
  LocationsAPI,
  readInstances,
  upsertExecNodeLocation,
} from './api';

function RunnerSites() {
  const [editing, setEditing] = useState(null); // { instance, assignment, form }
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const {
    result: { instances, assignments, locations },
    isLoading,
    error,
    request: fetchAll,
  } = useRequest(
    useCallback(async () => {
      const [i, a, l] = await Promise.all([
        readInstances({ page_size: 200 }),
        ExecNodeLocationsAPI.read({ page_size: 200 }),
        LocationsAPI.read({ page_size: 1000 }),
      ]);
      return {
        instances: i.data.results,
        assignments: a.data.results,
        locations: l.data.results,
      };
    }, []),
    { instances: [], assignments: [], locations: [] }
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const assignmentFor = (hostname) =>
    assignments.find((a) => a.instance_hostname === hostname) || null;

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

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{ '/runner_sites': 'Runner Sites' }}
      />
      <PageSection>
        <Card>
          <CardBody>
            {isLoading ? (
              <Spinner />
            ) : error ? (
              <Alert variant="danger" title="Failed to load" isInline />
            ) : (
              <TableComposable variant="compact" aria-label="Runner sites">
                <Thead>
                  <Tr>
                    <Th>Runner (instance)</Th>
                    <Th>Node type</Th>
                    <Th>Site</Th>
                    <Th>SSH user</Th>
                    <Th>ansible.cfg</Th>
                    <Th>Action</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {instances.map((inst) => {
                    const a = assignmentFor(inst.hostname);
                    return (
                      <Tr key={inst.id || inst.hostname}>
                        <Td dataLabel="Runner">{inst.hostname}</Td>
                        <Td dataLabel="Node type">
                          <Label isCompact>{inst.node_type}</Label>
                        </Td>
                        <Td dataLabel="Site">{a?.location_name || '—'}</Td>
                        <Td dataLabel="SSH user">{a?.ssh_user || '—'}</Td>
                        <Td dataLabel="ansible.cfg">
                          {a?.ansible_cfg ? 'set' : '—'}
                        </Td>
                        <Td dataLabel="Action">
                          <Button
                            variant="link"
                            isInline
                            onClick={() => openEdit(inst)}
                          >
                            {a ? 'edit assignment' : 'assign site'}
                          </Button>
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
              label="SSH credential ID (AWX machine credential)"
              fieldId="rs-cred"
            >
              <TextInput
                id="rs-cred"
                value={editing.form.ssh_credential_id}
                onChange={upd('ssh_credential_id')}
              />
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
