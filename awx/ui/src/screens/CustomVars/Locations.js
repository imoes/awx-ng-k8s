/* eslint-disable i18next/no-literal-string */
// awx-ng: Standorte (Sites) + Subnetze verwalten, mit NetBox-Reconcile.
import React, { useCallback, useEffect, useState } from 'react';
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
  const [breadcrumbConfig] = useState({ '/awx_ng/locations': 'Standorte' });
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [subnetFor, setSubnetFor] = useState(null); // location object
  const [reconcileResult, setReconcileResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const {
    result: locations,
    isLoading,
    error,
    request: fetchLocations,
  } = useRequest(
    useCallback(async () => {
      const { data } = await LocationsAPI.read({ page_size: 200 });
      return data.results;
    }, []),
    []
  );

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

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
      <ScreenHeader streamType="none" breadcrumbConfig={breadcrumbConfig} />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Standort anlegen
                  </Button>
                </ToolbarItem>
                <ToolbarItem>
                  <Button
                    variant="secondary"
                    onClick={handleReconcile}
                    isDisabled={busy}
                  >
                    Mit NetBox abgleichen
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {actionError && (
              <Alert variant="danger" title="Fehler" isInline>
                <pre>{JSON.stringify(actionError, null, 2)}</pre>
              </Alert>
            )}
            {reconcileResult && (
              <Alert
                variant="info"
                title="NetBox-Reconcile abgeschlossen"
                isInline
                actionClose={
                  <Button
                    variant="plain"
                    onClick={() => setReconcileResult(null)}
                  >
                    ×
                  </Button>
                }
              >
                Neue Standorte: {reconcileResult.created_locations?.length ?? 0},
                neue Subnetze: {reconcileResult.created_subnets?.length ?? 0},
                Drift: {reconcileResult.drift?.length ?? 0}
              </Alert>
            )}

            {isLoading ? (
              <Spinner />
            ) : error ? (
              <Alert variant="danger" title="Laden fehlgeschlagen" isInline />
            ) : (
              <TableComposable aria-label="Standorte" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Beschreibung</Th>
                    <Th>Quelle</Th>
                    <Th>NetBox-Slug</Th>
                    <Th>Subnetze</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {locations.map((loc) => (
                    <Tr key={loc.id}>
                      <Td dataLabel="Name">{loc.name}</Td>
                      <Td dataLabel="Beschreibung">{loc.description}</Td>
                      <Td dataLabel="Quelle">
                        <Label isCompact>{loc.source}</Label>
                      </Td>
                      <Td dataLabel="NetBox-Slug">{loc.netbox_site_slug}</Td>
                      <Td dataLabel="Subnetze">
                        <Button
                          variant="link"
                          isInline
                          onClick={() => setSubnetFor(loc)}
                        >
                          verwalten
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
        title="Standort anlegen"
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
            Anlegen
          </Button>,
          <Button
            key="cancel"
            variant="link"
            onClick={() => setCreateOpen(false)}
          >
            Abbrechen
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
          <FormGroup label="Beschreibung" fieldId="loc-desc">
            <TextInput
              id="loc-desc"
              value={newDesc}
              onChange={(v) => setNewDesc(v)}
            />
          </FormGroup>
        </Form>
      </Modal>

      {subnetFor && (
        <SubnetModal
          location={subnetFor}
          onClose={() => setSubnetFor(null)}
        />
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
      title={`Subnetze — ${location.name}`}
      isOpen
      variant="medium"
      onClose={onClose}
      actions={[
        <Button key="close" variant="primary" onClick={onClose}>
          Schließen
        </Button>,
      ]}
    >
      {err && (
        <Alert variant="danger" title="Fehler" isInline>
          <pre>{JSON.stringify(err, null, 2)}</pre>
        </Alert>
      )}
      {loading ? (
        <Spinner />
      ) : (
        <TableComposable variant="compact" aria-label="Subnetze">
          <Thead>
            <Tr>
              <Th>CIDR</Th>
              <Th>VLAN</Th>
              <Th>Gateway</Th>
              <Th>Quelle</Th>
            </Tr>
          </Thead>
          <Tbody>
            {subnets.map((s) => (
              <Tr key={s.id}>
                <Td dataLabel="CIDR">{s.cidr}</Td>
                <Td dataLabel="VLAN">{s.vlan}</Td>
                <Td dataLabel="Gateway">{s.gateway}</Td>
                <Td dataLabel="Quelle">{s.source}</Td>
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
          <TextInput
            id="sub-vlan"
            value={vlan}
            onChange={(v) => setVlan(v)}
          />
        </FormGroup>
        <FormGroup label="Gateway" fieldId="sub-gw">
          <TextInput
            id="sub-gw"
            value={gateway}
            onChange={(v) => setGateway(v)}
          />
        </FormGroup>
        <Button variant="secondary" onClick={add} isDisabled={!cidr}>
          Subnetz hinzufügen
        </Button>
      </Form>
    </Modal>
  );
}

export default Locations;
