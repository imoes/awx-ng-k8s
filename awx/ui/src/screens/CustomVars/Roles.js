/* eslint-disable i18next/no-literal-string */
// awx-ng: Role management screen — lists all roles per project, shows vars, triggers scan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  ExpandableSection,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  PageSection,
  SearchInput,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  TableComposable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import {
  readProjects,
  readProjectRoles,
  readProjectRoleVariables,
  triggerProjectRoleScan,
} from './api';

function Roles() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [roles, setRoles] = useState([]);
  const [lastScan, setLastScan] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [roleVars, setRoleVars] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState(null);
  const [scanMsg, setScanMsg] = useState(null);

  useEffect(() => {
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) => {
      setProjects(data.results || []);
      if (data.results && data.results.length > 0) {
        setProjectId(String(data.results[0].id));
      }
    });
  }, []);

  const loadRoles = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data } = await readProjectRoles(projectId);
      setRoles(data.results || []);
      setLastScan(data.last_scan || null);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadRoles();
    setExpanded({});
    setRoleVars({});
    setSearch('');
  }, [projectId, loadRoles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return roles;
    return roles.filter((r) => r.role_name.toLowerCase().includes(q));
  }, [roles, search]);

  const toggleExpand = async (roleName) => {
    const next = !expanded[roleName];
    setExpanded((prev) => ({ ...prev, [roleName]: next }));
    if (next && !roleVars[roleName] && projectId) {
      try {
        const { data } = await readProjectRoleVariables(projectId, {
          role_name: roleName,
          page_size: 200,
        });
        setRoleVars((prev) => ({ ...prev, [roleName]: data.results || [] }));
      } catch {
        setRoleVars((prev) => ({ ...prev, [roleName]: [] }));
      }
    }
  };

  const doScan = async () => {
    setScanning(true);
    setScanMsg(null);
    setErr(null);
    try {
      const { data } = await triggerProjectRoleScan(projectId);
      setScanMsg(
        `Scan complete: ${data.roles_found} roles, ${data.vars_extracted} vars, ` +
          `${data.tags_extracted} tags, ${data.handlers_extracted} handlers` +
          (data.errors?.length ? ` — ${data.errors.length} error(s)` : '')
      );
      await loadRoles();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{ '/roles': 'Roles' }}
      />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <FormGroup fieldId="roles-project" label="Project">
                    <FormSelect
                      id="roles-project"
                      value={projectId}
                      onChange={(v) => setProjectId(v)}
                      style={{ minWidth: 260 }}
                    >
                      {projects.map((p) => (
                        <FormSelectOption
                          key={p.id}
                          value={String(p.id)}
                          label={p.name}
                        />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </ToolbarItem>
                <ToolbarItem style={{ alignSelf: 'flex-end' }}>
                  <SearchInput
                    placeholder="Filter roles..."
                    value={search}
                    onChange={(_e, v) =>
                      setSearch(typeof v === 'string' ? v : _e?.target?.value ?? '')
                    }
                    onClear={() => setSearch('')}
                    style={{ minWidth: 260 }}
                  />
                </ToolbarItem>
                <ToolbarItem>
                  <Button
                    variant="primary"
                    onClick={doScan}
                    isDisabled={!projectId || scanning}
                  >
                    {scanning ? 'Scanning…' : 'Import / Scan roles'}
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {err && (
              <Alert variant="danger" title="Error" isInline style={{ marginTop: 8 }}>
                <pre>{JSON.stringify(err, null, 2)}</pre>
              </Alert>
            )}
            {scanMsg && (
              <Alert
                variant="success"
                title={scanMsg}
                isInline
                style={{ marginTop: 8 }}
                actionClose={
                  <Button variant="plain" onClick={() => setScanMsg(null)}>
                    ×
                  </Button>
                }
              />
            )}

            {lastScan && (
              <p style={{ color: '#6a6e73', fontSize: 13, margin: '8px 0' }}>
                Last scan: {lastScan.roles_found} roles, {lastScan.vars_extracted} vars,{' '}
                {lastScan.tags_extracted} tags, {lastScan.handlers_extracted} handlers
                {lastScan.revision && ` @ ${lastScan.revision.slice(0, 8)}`}
                {lastScan.errors?.length > 0 && (
                  <Label color="red" isCompact style={{ marginLeft: 8 }}>
                    {lastScan.errors.length} error(s)
                  </Label>
                )}
              </p>
            )}

            {loading ? (
              <Spinner />
            ) : (
              <TableComposable aria-label="Roles" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Role</Th>
                    <Th>Variables</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.map((role) => (
                    <React.Fragment key={role.role_name}>
                      <Tr>
                        <Td dataLabel="Role">
                          <Button
                            variant="link"
                            isInline
                            onClick={() => toggleExpand(role.role_name)}
                          >
                            {role.role_name}
                          </Button>
                        </Td>
                        <Td dataLabel="Variables">
                          {role.var_count > 0 ? (
                            <Label color="blue" isCompact>
                              {role.var_count} vars
                            </Label>
                          ) : (
                            <span style={{ color: '#6a6e73' }}>—</span>
                          )}
                        </Td>
                        <Td dataLabel="Status">
                          {role.on_disk && (
                            <Label color="green" isCompact style={{ marginRight: 4 }}>
                              on disk
                            </Label>
                          )}
                          {role.has_vars && (
                            <Label color="cyan" isCompact>
                              imported
                            </Label>
                          )}
                          {!role.on_disk && !role.has_vars && (
                            <Label color="grey" isCompact>
                              db only
                            </Label>
                          )}
                        </Td>
                      </Tr>
                      {expanded[role.role_name] && (
                        <Tr>
                          <Td colSpan={3} style={{ paddingLeft: 32, background: '#f5f5f5' }}>
                            {!roleVars[role.role_name] ? (
                              <Spinner size="sm" />
                            ) : roleVars[role.role_name].length === 0 ? (
                              <span style={{ color: '#6a6e73' }}>
                                No variables — role has no defaults/main.yml
                              </span>
                            ) : (
                              <TableComposable
                                variant="compact"
                                aria-label={`Variables for ${role.role_name}`}
                              >
                                <Thead>
                                  <Tr>
                                    <Th>Variable</Th>
                                    <Th>Type</Th>
                                    <Th>Source</Th>
                                    <Th>Default</Th>
                                  </Tr>
                                </Thead>
                                <Tbody>
                                  {roleVars[role.role_name].map((v) => (
                                    <Tr key={v.var_name}>
                                      <Td dataLabel="Variable">
                                        <code>{v.var_name}</code>
                                      </Td>
                                      <Td dataLabel="Type">
                                        <Label isCompact>{v.value_type}</Label>
                                      </Td>
                                      <Td dataLabel="Source">{v.source}</Td>
                                      <Td dataLabel="Default">
                                        <code style={{ fontSize: 11 }}>
                                          {v.value_type === 'dict' || v.value_type === 'list'
                                            ? JSON.stringify(v.default_value).slice(0, 80)
                                            : String(v.default_value ?? '').slice(0, 80)}
                                        </code>
                                      </Td>
                                    </Tr>
                                  ))}
                                </Tbody>
                              </TableComposable>
                            )}
                          </Td>
                        </Tr>
                      )}
                    </React.Fragment>
                  ))}
                </Tbody>
              </TableComposable>
            )}
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}

export default Roles;
