/* eslint-disable i18next/no-literal-string */
// awx-ng: Playbook management screen — lists a project's playbooks and their plays
// (target pattern, roles, tags), with quick links to the editor and to creating a
// Job Template. Complements the Roles screen.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
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
import { readProjects, readProjectPlays } from './api';

function Playbooks() {
  const history = useHistory();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [playbooks, setPlaybooks] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) => {
      setProjects(data.results || []);
      if (data.results?.length > 0) setProjectId(String(data.results[0].id));
    });
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data } = await readProjectPlays(projectId);
      setPlaybooks(data.results || []);
    } catch (e) {
      setErr(e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    setExpanded({});
    setSearch('');
  }, [projectId, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return playbooks;
    return playbooks.filter((p) => p.playbook.toLowerCase().includes(q));
  }, [playbooks, search]);

  const openInEditor = (playbook) =>
    history.push(
      `/editor?project=${projectId}&path=${encodeURIComponent(playbook)}`
    );

  const createTemplate = () => history.push('/templates/job_template/add');

  return (
    <>
      <ScreenHeader streamType="none" breadcrumbConfig={{ '/playbooks': 'Playbooks' }} />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <FormGroup fieldId="pb-project" label="Project">
                    <FormSelect
                      id="pb-project"
                      value={projectId}
                      onChange={(v) => setProjectId(v)}
                      style={{ minWidth: 260 }}
                    >
                      {projects.map((p) => (
                        <FormSelectOption key={p.id} value={String(p.id)} label={p.name} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </ToolbarItem>
                <ToolbarItem style={{ alignSelf: 'flex-end' }}>
                  <SearchInput
                    placeholder="Filter playbooks..."
                    value={search}
                    onChange={(_e, v) =>
                      setSearch(typeof v === 'string' ? v : _e?.target?.value ?? '')
                    }
                    onClear={() => setSearch('')}
                    style={{ minWidth: 260 }}
                  />
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {err && (
              <Alert variant="danger" title="Error" isInline style={{ marginTop: 8 }}>
                <pre>{JSON.stringify(err, null, 2)}</pre>
              </Alert>
            )}

            {loading ? (
              <Spinner />
            ) : (
              <TableComposable aria-label="Playbooks" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Playbook</Th>
                    <Th>Plays</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.map((pb) => (
                    <React.Fragment key={pb.playbook}>
                      <Tr>
                        <Td dataLabel="Playbook">
                          <Button
                            variant="link"
                            isInline
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [pb.playbook]: !prev[pb.playbook],
                              }))
                            }
                          >
                            <code>{pb.playbook}</code>
                          </Button>
                        </Td>
                        <Td dataLabel="Plays">
                          <Label color="blue" isCompact>{pb.plays.length} plays</Label>
                        </Td>
                        <Td dataLabel="Actions">
                          <Button variant="link" isInline onClick={() => openInEditor(pb.playbook)}>
                            Open in editor
                          </Button>{' '}
                          <Button variant="link" isInline onClick={createTemplate}>
                            Create template
                          </Button>
                        </Td>
                      </Tr>
                      {expanded[pb.playbook] && (
                        <Tr>
                          <Td colSpan={3} style={{ paddingLeft: 32, background: '#f5f5f5' }}>
                            <TableComposable variant="compact" aria-label={`Plays in ${pb.playbook}`}>
                              <Thead>
                                <Tr>
                                  <Th>Name</Th>
                                  <Th>Target (hosts)</Th>
                                  <Th>Roles</Th>
                                  <Th>Tags</Th>
                                </Tr>
                              </Thead>
                              <Tbody>
                                {pb.plays.map((play, i) => (
                                  // eslint-disable-next-line react/no-array-index-key
                                  <Tr key={`${pb.playbook}-${i}`}>
                                    <Td dataLabel="Name">
                                      {play.kind === 'import_playbook' ? (
                                        <em>import_playbook: <code>{play.name}</code></em>
                                      ) : (
                                        play.name || <span style={{ color: '#6a6e73' }}>—</span>
                                      )}
                                    </Td>
                                    <Td dataLabel="Target">
                                      {play.hosts ? <code>{play.hosts}</code> : '—'}
                                    </Td>
                                    <Td dataLabel="Roles">
                                      {play.roles?.length
                                        ? play.roles.map((r) => (
                                            <Label key={r} isCompact color="purple" style={{ marginRight: 4 }}>
                                              {r}
                                            </Label>
                                          ))
                                        : '—'}
                                    </Td>
                                    <Td dataLabel="Tags">
                                      {play.tags?.length ? play.tags.join(', ') : '—'}
                                    </Td>
                                  </Tr>
                                ))}
                              </Tbody>
                            </TableComposable>
                          </Td>
                        </Tr>
                      )}
                    </React.Fragment>
                  ))}
                  {filtered.length === 0 && (
                    <Tr>
                      <Td colSpan={3} style={{ color: '#6a6e73' }}>
                        No playbooks found in this project.
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </TableComposable>
            )}
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}

export default Playbooks;
