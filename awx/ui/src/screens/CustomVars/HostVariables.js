/* eslint-disable i18next/no-literal-string */
// awx-ng: Host-Variablen-Verwaltung.
// Rollen zuweisen → Variablen werden materialisiert → pro Host editierbar
// (großes Editierfeld). Plus aggregierte Sicht mit Herkunft.
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
  Checkbox,
  Alert,
  Spinner,
  Split,
  SplitItem,
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
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import useRequest from 'hooks/useRequest';
import {
  readHosts,
  readProjects,
  readProjectRoleVariables,
  readHostRoleVariables,
  patchHostRoleVariable,
  resetHostRoleVariable,
  assignHostRoles,
  cloneHost,
} from './api';

function HostVariables() {
  const [breadcrumbConfig] = useState({
    '/awx_ng/host_variables': 'Host-Variablen',
  });
  const [hostId, setHostId] = useState('');
  const [projectId, setProjectId] = useState('');
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

  // Hosts + Projekte laden
  const {
    result: { hosts, projects },
    request: fetchBase,
  } = useRequest(
    useCallback(async () => {
      const [h, p] = await Promise.all([
        readHosts({ page_size: 200, order_by: 'name' }),
        readProjects({ page_size: 200, order_by: 'name' }),
      ]);
      return { hosts: h.data.results, projects: p.data.results };
    }, []),
    { hosts: [], projects: [] }
  );
  useEffect(() => {
    fetchBase();
  }, [fetchBase]);

  const loadHostVars = useCallback(async (hid) => {
    if (!hid) {
      setHostVars([]);
      return;
    }
    const { data } = await readHostRoleVariables(hid, { page_size: 500 });
    setHostVars(data.results);
  }, []);

  useEffect(() => {
    loadHostVars(hostId);
    setSelectedRoles([]);
  }, [hostId, loadHostVars]);

  // Verfügbare Rollen des gewählten Projekts ermitteln
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
      // bereits zugewiesene Rollen + neu ausgewählte vereinigen
      const current = Array.from(new Set(hostVars.map((v) => v.role_name)));
      const roles = Array.from(new Set([...current, ...selectedRoles]));
      const { data } = await assignHostRoles(hostId, roles, Number(projectId));
      setMsg(
        `${data.variables_materialized} Variablen materialisiert für Rollen: ${roles.join(', ')}`
      );
      setSelectedRoles([]);
      loadHostVars(hostId);
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
        parsed = editText; // Roh-String erlauben
      }
      await patchHostRoleVariable(hostId, editingVar.id, parsed);
      setEditingVar(null);
      loadHostVars(hostId);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setBusy(false);
    }
  };

  const resetVar = async (v) => {
    await resetHostRoleVariable(hostId, v.id);
    loadHostVars(hostId);
  };

  const doClone = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { data } = await cloneHost(hostId, cloneName, cloneGroups);
      setCloneOpen(false);
      setCloneName('');
      await fetchBase(); // Host-Liste neu laden, damit der Klon auftaucht
      setHostId(String(data.id)); // auf den Klon umschalten
      setMsg(
        `Host '${data.name}' geklont (${data.role_variables_copied} Variablen, ${data.groups_copied} Gruppen).`
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
      <ScreenHeader streamType="none" breadcrumbConfig={breadcrumbConfig} />
      <PageSection>
        <Card>
          <CardBody>
            <Split hasGutter>
              <SplitItem isFilled>
                <FormGroup label="Host" fieldId="hv-host">
                  <FormSelect
                    id="hv-host"
                    value={hostId}
                    onChange={(v) => setHostId(v)}
                  >
                    <FormSelectOption value="" label="— Host wählen —" />
                    {hosts.map((h) => (
                      <FormSelectOption
                        key={h.id}
                        value={String(h.id)}
                        label={h.name}
                      />
                    ))}
                  </FormSelect>
                </FormGroup>
              </SplitItem>
              {hostId && (
                <SplitItem>
                  <div style={{ marginTop: 32 }}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const cur = hosts.find((h) => String(h.id) === hostId);
                        setCloneName(cur ? `${cur.name}-clone` : '');
                        setCloneOpen(true);
                      }}
                    >
                      Host klonen
                    </Button>
                  </div>
                </SplitItem>
              )}
            </Split>

            {msg && (
              <Alert variant="success" title={msg} isInline style={{ marginTop: 12 }} />
            )}
            {err && (
              <Alert variant="danger" title="Fehler" isInline style={{ marginTop: 12 }}>
                <pre>{JSON.stringify(err, null, 2)}</pre>
              </Alert>
            )}

            {hostId && (
              <>
                <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
                  Zugewiesene Rollen
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
                  <p>Noch keine Rollen zugewiesen.</p>
                )}

                <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
                  Rollen zuweisen
                </Title>
                <Split hasGutter>
                  <SplitItem>
                    <FormGroup label="Projekt" fieldId="hv-proj">
                      <FormSelect
                        id="hv-proj"
                        value={projectId}
                        onChange={(v) => setProjectId(v)}
                      >
                        <FormSelectOption value="" label="— Projekt —" />
                        {projects.map((p) => (
                          <FormSelectOption
                            key={p.id}
                            value={String(p.id)}
                            label={p.name}
                          />
                        ))}
                      </FormSelect>
                    </FormGroup>
                  </SplitItem>
                </Split>
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
                        {selectedRoles.length} Rolle(n) zuweisen
                      </Button>
                    </div>
                  </div>
                )}

                <Title headingLevel="h3" size="md" style={{ marginTop: 24 }}>
                  Rollen-Variablen dieses Hosts
                </Title>
                <TableComposable variant="compact" aria-label="Host-Variablen">
                  <Thead>
                    <Tr>
                      <Th>Rolle</Th>
                      <Th>Variable</Th>
                      <Th>Wert</Th>
                      <Th>Status</Th>
                      <Th>Aktion</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {hostVars.map((v) => (
                      <Tr key={v.id}>
                        <Td dataLabel="Rolle">{v.role_name}</Td>
                        <Td dataLabel="Variable">{v.var_name}</Td>
                        <Td dataLabel="Wert">
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
                              überschrieben
                            </Label>
                          ) : (
                            <Label color="grey" isCompact>
                              Default
                            </Label>
                          )}
                        </Td>
                        <Td dataLabel="Aktion">
                          <Button
                            variant="link"
                            isInline
                            onClick={() => openEdit(v)}
                          >
                            bearbeiten
                          </Button>
                          {v.is_overridden && (
                            <>
                              {' '}
                              <Button
                                variant="link"
                                isInline
                                onClick={() => resetVar(v)}
                              >
                                zurücksetzen
                              </Button>
                            </>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </TableComposable>
              </>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {cloneOpen && (
        <Modal
          title="Host klonen"
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
              Klonen
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setCloneOpen(false)}>
              Abbrechen
            </Button>,
          ]}
        >
          <Form>
            <FormGroup label="Name des neuen Hosts" isRequired fieldId="clone-name">
              <TextInput
                id="clone-name"
                value={cloneName}
                onChange={(v) => setCloneName(v)}
              />
            </FormGroup>
            <FormGroup fieldId="clone-groups">
              <Checkbox
                id="clone-groups"
                label="Gruppen-Mitgliedschaften mitkopieren"
                isChecked={cloneGroups}
                onChange={(checked) => setCloneGroups(checked)}
              />
            </FormGroup>
            <p style={{ color: '#6a6e73' }}>
              Kopiert host_vars, alle Rollen-Variablen-Overrides und (optional) die
              Gruppen. Danach kannst du die Variablen des Klons anpassen.
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
              Speichern
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setEditingVar(null)}>
              Abbrechen
            </Button>,
          ]}
        >
          <p style={{ marginBottom: 8 }}>
            Rollen-Default:{' '}
            <code>
              {typeof editingVar.default_value === 'string'
                ? editingVar.default_value
                : JSON.stringify(editingVar.default_value)}
            </code>
          </p>
          <TextArea
            aria-label="Variablenwert"
            value={editText}
            onChange={(v) => setEditText(v)}
            rows={20}
            resizeOrientation="vertical"
            style={{ fontFamily: 'monospace' }}
          />
          <p style={{ marginTop: 8, color: '#6a6e73' }}>
            JSON wird geparst; ungültiges JSON wird als roher String gespeichert.
          </p>
        </Modal>
      )}
    </>
  );
}

export default HostVariables;
