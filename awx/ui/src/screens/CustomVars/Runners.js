/* eslint-disable i18next/no-literal-string */
// awx-ng: Runner ↔ Site-Zuordnung mit ssh_user, ssh_credential_id, ansible.cfg.
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
  Toolbar,
  ToolbarContent,
  ToolbarItem,
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
import { ExecNodeLocationsAPI, LocationsAPI } from './api';

const EMPTY = {
  instance_hostname: '',
  location: '',
  ssh_user: '',
  ssh_credential_id: '',
  ansible_cfg: '',
};

function Runners() {
  const [breadcrumbConfig] = useState({ '/awx_ng/runners': 'Runner ↔ Site' });
  const [editing, setEditing] = useState(null); // form object or null
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const {
    result: { runners, locations },
    isLoading,
    error,
    request: fetchAll,
  } = useRequest(
    useCallback(async () => {
      const [r, l] = await Promise.all([
        ExecNodeLocationsAPI.read({ page_size: 200 }),
        LocationsAPI.read({ page_size: 200 }),
      ]);
      return { runners: r.data.results, locations: l.data.results };
    }, []),
    { runners: [], locations: [] }
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const locName = (id) => locations.find((l) => l.id === id)?.name || '—';

  const save = async () => {
    setBusy(true);
    setActionError(null);
    const payload = {
      instance_hostname: editing.instance_hostname,
      location: editing.location || null,
      ssh_user: editing.ssh_user,
      ssh_credential_id: editing.ssh_credential_id
        ? Number(editing.ssh_credential_id)
        : null,
      ansible_cfg: editing.ansible_cfg,
    };
    try {
      if (editing.id) {
        await ExecNodeLocationsAPI.update(editing.id, payload);
      } else {
        await ExecNodeLocationsAPI.create(payload);
      }
      setEditing(null);
      fetchAll();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    await ExecNodeLocationsAPI.destroy(id);
    fetchAll();
  };

  const upd = (field) => (v) => setEditing((p) => ({ ...p, [field]: v }));

  return (
    <>
      <ScreenHeader streamType="none" breadcrumbConfig={breadcrumbConfig} />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <Button
                    variant="primary"
                    onClick={() => setEditing({ ...EMPTY })}
                  >
                    Runner-Zuordnung anlegen
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {isLoading ? (
              <Spinner />
            ) : error ? (
              <Alert variant="danger" title="Laden fehlgeschlagen" isInline />
            ) : (
              <TableComposable variant="compact" aria-label="Runner">
                <Thead>
                  <Tr>
                    <Th>Runner (Instanz)</Th>
                    <Th>Standort</Th>
                    <Th>SSH-User</Th>
                    <Th>Credential-ID</Th>
                    <Th>ansible.cfg</Th>
                    <Th>Aktion</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {runners.map((r) => (
                    <Tr key={r.id}>
                      <Td dataLabel="Runner">{r.instance_hostname}</Td>
                      <Td dataLabel="Standort">
                        {r.location_name || locName(r.location)}
                      </Td>
                      <Td dataLabel="SSH-User">{r.ssh_user}</Td>
                      <Td dataLabel="Credential-ID">{r.ssh_credential_id}</Td>
                      <Td dataLabel="ansible.cfg">
                        {r.ansible_cfg ? 'gesetzt' : '—'}
                      </Td>
                      <Td dataLabel="Aktion">
                        <Button
                          variant="link"
                          isInline
                          onClick={() => setEditing({ ...r, location: r.location || '' })}
                        >
                          bearbeiten
                        </Button>{' '}
                        <Button
                          variant="link"
                          isInline
                          isDanger
                          onClick={() => remove(r.id)}
                        >
                          löschen
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </TableComposable>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {editing && (
        <Modal
          title={editing.id ? 'Runner-Zuordnung bearbeiten' : 'Runner-Zuordnung anlegen'}
          isOpen
          variant="medium"
          onClose={() => setEditing(null)}
          actions={[
            <Button
              key="save"
              variant="primary"
              onClick={save}
              isDisabled={!editing.instance_hostname || busy}
            >
              Speichern
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setEditing(null)}>
              Abbrechen
            </Button>,
          ]}
        >
          {actionError && (
            <Alert variant="danger" title="Fehler" isInline>
              <pre>{JSON.stringify(actionError, null, 2)}</pre>
            </Alert>
          )}
          <Form>
            <FormGroup
              label="Runner (AWX-Instanz-Hostname / Receptor-Node)"
              isRequired
              fieldId="r-host"
            >
              <TextInput
                id="r-host"
                value={editing.instance_hostname}
                onChange={upd('instance_hostname')}
              />
            </FormGroup>
            <FormGroup label="Standort" fieldId="r-loc">
              <FormSelect
                id="r-loc"
                value={editing.location}
                onChange={upd('location')}
              >
                <FormSelectOption value="" label="— keiner —" />
                {locations.map((l) => (
                  <FormSelectOption key={l.id} value={l.id} label={l.name} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="SSH-User" fieldId="r-user">
              <TextInput
                id="r-user"
                value={editing.ssh_user}
                onChange={upd('ssh_user')}
              />
            </FormGroup>
            <FormGroup
              label="SSH-Credential-ID (AWX Machine-Credential)"
              fieldId="r-cred"
            >
              <TextInput
                id="r-cred"
                value={editing.ssh_credential_id}
                onChange={upd('ssh_credential_id')}
              />
            </FormGroup>
            <FormGroup label="ansible.cfg (für diese Site)" fieldId="r-cfg">
              <TextArea
                id="r-cfg"
                value={editing.ansible_cfg}
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

export default Runners;
