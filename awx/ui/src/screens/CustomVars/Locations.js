/* eslint-disable i18next/no-literal-string */
// awx-ng: Sites — a Site is a named group of runners and maps 1:1 to an AWX
// Instance Group. Site-level SSH credential / ansible.cfg / environment apply to
// all runners of the site; a single runner may override them (runner wins).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  SearchInput,
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
  LocationsAPI,
  reconcileLocations,
  listMachineCredentials,
} from './api';

const EMPTY_FORM = {
  name: '',
  description: '',
  ssh_credential_id: '',
  ansible_cfg: '',
  environment: '',
};

function Locations() {
  const [editing, setEditing] = useState(null); // { id?, ...form } or null
  const [reconcileResult, setReconcileResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');

  const {
    result: { locations, credentials },
    isLoading,
    error,
    request: fetchAll,
  } = useRequest(
    useCallback(async () => {
      const [l, c] = await Promise.all([
        LocationsAPI.read({ page_size: 1000 }),
        listMachineCredentials(),
      ]);
      return {
        locations: l.data.results,
        credentials: c.data.results,
      };
    }, []),
    { locations: [], credentials: [] }
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return locations;
    return locations.filter(
      (l) =>
        l.name?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.netbox_site_slug?.toLowerCase().includes(q)
    );
  }, [locations, search]);

  const openCreate = () => {
    setEditing({ ...EMPTY_FORM });
    setActionError(null);
  };

  const openEdit = (loc) => {
    setEditing({
      id: loc.id,
      name: loc.name || '',
      description: loc.description || '',
      ssh_credential_id: loc.ssh_credential_id ?? '',
      ansible_cfg: loc.ansible_cfg || '',
      environment: loc.environment || '',
    });
    setActionError(null);
  };

  const upd = (field) => (v) =>
    setEditing((p) => ({ ...p, [field]: v }));

  const handleSave = async () => {
    setBusy(true);
    setActionError(null);
    const payload = {
      name: editing.name,
      description: editing.description,
      ssh_credential_id: editing.ssh_credential_id
        ? Number(editing.ssh_credential_id)
        : null,
      ansible_cfg: editing.ansible_cfg,
      environment: editing.environment,
    };
    try {
      if (editing.id) {
        await LocationsAPI.update(editing.id, payload);
      } else {
        await LocationsAPI.create(payload);
      }
      setEditing(null);
      fetchAll();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (loc) => {
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `Delete site "${loc.name}"? This also removes its instance group.`
      )
    )
      return;
    setActionError(null);
    try {
      await LocationsAPI.destroy(loc.id);
      fetchAll();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    }
  };

  const handleReconcile = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { data } = await reconcileLocations();
      setReconcileResult(data);
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
        breadcrumbConfig={{ '/locations': 'Sites' }}
      />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <SearchInput
                    placeholder="Search by name, slug or description"
                    value={search}
                    onChange={(_e, v) =>
                      setSearch(typeof v === 'string' ? v : _e?.target?.value ?? '')
                    }
                    onClear={() => setSearch('')}
                    style={{ minWidth: 320 }}
                  />
                </ToolbarItem>
                <ToolbarItem>
                  <Button variant="primary" onClick={openCreate}>
                    Add site
                  </Button>
                </ToolbarItem>
                <ToolbarItem>
                  <Button
                    variant="secondary"
                    onClick={handleReconcile}
                    isDisabled={busy}
                  >
                    Reconcile with NetBox
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {actionError && (
              <Alert variant="danger" title="Error" isInline>
                <pre>{JSON.stringify(actionError, null, 2)}</pre>
              </Alert>
            )}
            {reconcileResult && (
              <Alert
                variant="info"
                title="NetBox reconcile finished"
                isInline
                actionClose={
                  <Button variant="plain" onClick={() => setReconcileResult(null)}>
                    ×
                  </Button>
                }
              >
                New locations: {reconcileResult.created_locations?.length ?? 0},
                drift: {reconcileResult.drift?.length ?? 0}
              </Alert>
            )}

            {isLoading ? (
              <Spinner />
            ) : error ? (
              <Alert variant="danger" title="Failed to load" isInline />
            ) : (
              <TableComposable aria-label="Sites" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Description</Th>
                    <Th>Source</Th>
                    <Th>NetBox slug</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.map((loc) => (
                    <Tr key={loc.id}>
                      <Td dataLabel="Name">{loc.name}</Td>
                      <Td dataLabel="Description">{loc.description}</Td>
                      <Td dataLabel="Source">
                        <Label isCompact>{loc.source}</Label>
                      </Td>
                      <Td dataLabel="NetBox slug">{loc.netbox_site_slug}</Td>
                      <Td dataLabel="Actions">
                        <Button
                          variant="link"
                          isInline
                          onClick={() => openEdit(loc)}
                        >
                          edit
                        </Button>
                        {' · '}
                        <Button
                          variant="link"
                          isInline
                          isDanger
                          onClick={() => handleDelete(loc)}
                        >
                          delete
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
          title={editing.id ? `Edit site — ${editing.name}` : 'Add site'}
          isOpen
          variant="medium"
          onClose={() => setEditing(null)}
          actions={[
            <Button
              key="save"
              variant="primary"
              onClick={handleSave}
              isDisabled={!editing.name || busy}
            >
              Save
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setEditing(null)}>
              Cancel
            </Button>,
          ]}
        >
          <Form>
            <FormGroup label="Name" isRequired fieldId="loc-name">
              <TextInput
                id="loc-name"
                value={editing.name}
                onChange={upd('name')}
              />
            </FormGroup>
            <FormGroup label="Description" fieldId="loc-desc">
              <TextInput
                id="loc-desc"
                value={editing.description}
                onChange={upd('description')}
              />
            </FormGroup>
            <FormGroup
              label="Machine credential (site default)"
              fieldId="loc-cred"
              helperText="Used by all runners of this site unless a runner overrides it; and when the job template has no machine credential of its own."
            >
              <FormSelect
                id="loc-cred"
                value={editing.ssh_credential_id}
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
            <FormGroup
              label="Environment variables (site default)"
              fieldId="loc-env"
              helperText="KEY=VALUE per line — injected into every job that runs on this site (e.g. https_proxy=http://proxy:80). A runner can override."
            >
              <TextArea
                id="loc-env"
                value={editing.environment}
                onChange={upd('environment')}
                rows={4}
                resizeOrientation="vertical"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder={'https_proxy=http://proxy.example.com:80\nhttp_proxy=http://proxy.example.com:80'}
              />
            </FormGroup>
            <FormGroup
              label="ansible.cfg (site default)"
              fieldId="loc-cfg"
            >
              <TextArea
                id="loc-cfg"
                value={editing.ansible_cfg}
                onChange={upd('ansible_cfg')}
                rows={6}
                resizeOrientation="vertical"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </FormGroup>
          </Form>
        </Modal>
      )}
    </>
  );
}

export default Locations;
