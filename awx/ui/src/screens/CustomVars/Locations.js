/* eslint-disable i18next/no-literal-string */
// awx-ng: Locations (sites) + subnets, searchable list, with NetBox reconcile.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  PageSection,
  Modal,
  Form,
  FormGroup,
  TextInput,
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
  readSubnets,
  createSubnet,
  reconcileLocations,
} from './api';

function Locations() {
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [subnetFor, setSubnetFor] = useState(null);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');

  const {
    result: locations,
    isLoading,
    error,
    request: fetchLocations,
  } = useRequest(
    useCallback(async () => {
      const { data } = await LocationsAPI.read({ page_size: 1000 });
      return data.results;
    }, []),
    []
  );

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(
      (l) =>
        l.name?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.netbox_site_slug?.toLowerCase().includes(q)
    );
  }, [locations, search]);

  const handleCreate = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await LocationsAPI.create({ name: newName, description: newDesc });
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      fetchLocations();
    } catch (e) {
      setActionError(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReconcile = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { data } = await reconcileLocations();
      setReconcileResult(data);
      fetchLocations();
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
        breadcrumbConfig={{ '/locations': 'Locations' }}
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
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Add location
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
                new subnets: {reconcileResult.created_subnets?.length ?? 0}, drift:{' '}
                {reconcileResult.drift?.length ?? 0}
              </Alert>
            )}

            {isLoading ? (
              <Spinner />
            ) : error ? (
              <Alert variant="danger" title="Failed to load" isInline />
            ) : (
              <TableComposable aria-label="Locations" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Description</Th>
                    <Th>Source</Th>
                    <Th>NetBox slug</Th>
                    <Th>Subnets</Th>
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
                      <Td dataLabel="Subnets">
                        <Button
                          variant="link"
                          isInline
                          onClick={() => setSubnetFor(loc)}
                        >
                          manage
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

      <Modal
        title="Add location"
        isOpen={isCreateOpen}
        variant="small"
        onClose={() => setCreateOpen(false)}
        actions={[
          <Button
            key="create"
            variant="primary"
            onClick={handleCreate}
            isDisabled={!newName || busy}
          >
            Add
          </Button>,
          <Button key="cancel" variant="link" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>,
        ]}
      >
        <Form>
          <FormGroup label="Name" isRequired fieldId="loc-name">
            <TextInput
              id="loc-name"
              value={newName}
              onChange={(v) => setNewName(v)}
            />
          </FormGroup>
          <FormGroup label="Description" fieldId="loc-desc">
            <TextInput
              id="loc-desc"
              value={newDesc}
              onChange={(v) => setNewDesc(v)}
            />
          </FormGroup>
        </Form>
      </Modal>

      {subnetFor && (
        <SubnetModal location={subnetFor} onClose={() => setSubnetFor(null)} />
      )}
    </>
  );
}

function SubnetModal({ location, onClose }) {
  const [subnets, setSubnets] = useState([]);
  const [cidr, setCidr] = useState('');
  const [vlan, setVlan] = useState('');
  const [gateway, setGateway] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await readSubnets(location.id);
      setSubnets(data.results || data);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }, [location.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setErr(null);
    try {
      await createSubnet(location.id, {
        cidr,
        vlan: vlan ? Number(vlan) : null,
        gateway,
      });
      setCidr('');
      setVlan('');
      setGateway('');
      load();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    }
  };

  return (
    <Modal
      title={`Subnets — ${location.name}`}
      isOpen
      variant="medium"
      onClose={onClose}
      actions={[
        <Button key="close" variant="primary" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      {err && (
        <Alert variant="danger" title="Error" isInline>
          <pre>{JSON.stringify(err, null, 2)}</pre>
        </Alert>
      )}
      {loading ? (
        <Spinner />
      ) : (
        <TableComposable variant="compact" aria-label="Subnets">
          <Thead>
            <Tr>
              <Th>CIDR</Th>
              <Th>VLAN</Th>
              <Th>Gateway</Th>
              <Th>Source</Th>
            </Tr>
          </Thead>
          <Tbody>
            {subnets.map((s) => (
              <Tr key={s.id}>
                <Td dataLabel="CIDR">{s.cidr}</Td>
                <Td dataLabel="VLAN">{s.vlan}</Td>
                <Td dataLabel="Gateway">{s.gateway}</Td>
                <Td dataLabel="Source">{s.source}</Td>
              </Tr>
            ))}
          </Tbody>
        </TableComposable>
      )}
      <Form style={{ marginTop: 16 }}>
        <FormGroup label="CIDR" isRequired fieldId="sub-cidr">
          <TextInput
            id="sub-cidr"
            placeholder="10.32.188.0/24"
            value={cidr}
            onChange={(v) => setCidr(v)}
          />
        </FormGroup>
        <FormGroup label="VLAN" fieldId="sub-vlan">
          <TextInput id="sub-vlan" value={vlan} onChange={(v) => setVlan(v)} />
        </FormGroup>
        <FormGroup label="Gateway" fieldId="sub-gw">
          <TextInput
            id="sub-gw"
            value={gateway}
            onChange={(v) => setGateway(v)}
          />
        </FormGroup>
        <Button variant="secondary" onClick={add} isDisabled={!cidr}>
          Add subnet
        </Button>
      </Form>
    </Modal>
  );
}

export default Locations;
