/* eslint-disable i18next/no-literal-string */
// awx-ng: Playbook management screen — lists a project's playbooks (recursively, from
// AWX's playbook detection) and lazily shows each playbook's plays (target pattern,
// roles, tags), with quick links to the editor and to creating a Job Template.
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
import { readProjects, readProjectPlays, deleteProjectFile } from './api';

function Playbooks() {
  const history = useHistory();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [playbooks, setPlaybooks] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [plays, setPlays] = useState({}); // path -> plays[] | 'loading'
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
    setExpanded({});
    setPlays({});
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
    setSearch('');
  }, [projectId, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return playbooks;
    return playbooks.filter((p) => p.playbook.toLowerCase().includes(q));
  }, [playbooks, search]);

  const toggleExpand = async (playbook) => {
    const next = !expanded[playbook];
    setExpanded((prev) => ({ ...prev, [playbook]: next }));
    if (next && plays[playbook] === undefined) {
      setPlays((prev) => ({ ...prev, [playbook]: 'loading' }));
      try {
        const { data } = await readProjectPlays(projectId, { playbook });
        setPlays((prev) => ({ ...prev, [playbook]: data.plays || [] }));
      } catch {
        setPlays((prev) => ({ ...prev, [playbook]: [] }));
      }
    }
  };

  const openInEditor = (playbook) =>
    history.push(`/editor?project=${projectId}&path=${encodeURIComponent(playbook)}`);

  const createTemplate = () => history.push('/templates/job_template/add');

  const deletePlaybook = async (playbook) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete playbook "${playbook}"?`)) return;
    setErr(null);
    try {
      await deleteProjectFile(projectId, playbook);
      await load();
    } catch (e) {
      setErr(e?.response?.data || e.message);
    }
  };

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
                <ToolbarItem>
                  <Button
                    variant="primary"
                    onClick={load}
                    isDisabled={!projectId || loading}
                  >
                    {loading ? 'Loading…' : 'Refresh'}
                  </Button>
                </ToolbarItem>
                <ToolbarItem alignment={{ default: 'alignRight' }}>
                  <span style={{ color: '#6a6e73', fontSize: 13 }}>
                    {playbooks.length} playbooks
                  </span>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {err && (
              <Alert variant="danger" title="Error" isInline style={{ marginTop: 8 }}>
                <pre>{JSON.stringify(err, null, 2)}</pre>
              </Alert>
            )}

            <p style={{ color: '#6a6e73', fontSize: 13, margin: '4px 0 8px' }}>
              Detected from the project (incl. subfolders like <code>playbooks/</code>).
              New files appear after a project sync. Click a playbook to inspect its plays.
            </p>

            {loading ? (
              <Spinner />
            ) : (
              <TableComposable aria-label="Playbooks" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Playbook</Th>
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
                            onClick={() => toggleExpand(pb.playbook)}
                          >
                            <code>{pb.playbook}</code>
                          </Button>
                        </Td>
                        <Td dataLabel="Actions">
                          <Button variant="link" isInline onClick={() => openInEditor(pb.playbook)}>
                            Open in editor
                          </Button>{' '}
                          <Button variant="link" isInline onClick={createTemplate}>
                            Create template
                          </Button>{' '}
                          <Button
                            variant="link"
                            isDanger
                            isInline
                            onClick={() => deletePlaybook(pb.playbook)}
                          >
                            Delete
                          </Button>
                        </Td>
                      </Tr>
                      {expanded[pb.playbook] && (
                        <Tr>
                          <Td colSpan={2} style={{ paddingLeft: 32, background: '#f5f5f5' }}>
                            {plays[pb.playbook] === 'loading' || plays[pb.playbook] === undefined ? (
                              <Spinner size="sm" />
                            ) : plays[pb.playbook].length === 0 ? (
                              <span style={{ color: '#6a6e73' }}>
                                No plays parsed (not a standard playbook or empty).
                              </span>
                            ) : (
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
                                  {plays[pb.playbook].map((play, i) => (
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
                            )}
                          </Td>
                        </Tr>
                      )}
                    </React.Fragment>
                  ))}
                  {filtered.length === 0 && (
                    <Tr>
                      <Td colSpan={2} style={{ color: '#6a6e73' }}>
                        {playbooks.length === 0
                          ? 'No playbooks detected. Run a project sync, then Refresh.'
                          : `No playbooks matching "${search}".`}
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
