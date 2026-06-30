/* eslint-disable i18next/no-literal-string */
// awx-ng: Ansible Vault Store — manage named vaults with key-value variables.
// Vault files are generated via ansible-vault encrypt and injected at job runtime.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  ClipboardCopy,
  CodeBlock,
  CodeBlockCode,
  Form,
  FormGroup,
  Modal,
  PageSection,
  SearchInput,
  Spinner,
  TextArea,
  TextInput,
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
import { PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import useRequest from 'hooks/useRequest';
import {
  listVaults,
  createVault,
  updateVault,
  deleteVault,
  generateVaultFile,
  readProjects,
} from './api';

const EMPTY_FORM = { name: '', description: '', variables: {} };

function VaultVariableEditor({ variables, onChange }) {
  const [entries, setEntries] = useState(() =>
    Object.entries(variables || {}).map(([k, v]) => ({ key: k, value: String(v) }))
  );
  const [showValues, setShowValues] = useState({});

  const push = (updated) => {
    setEntries(updated);
    const obj = {};
    updated.forEach(({ key, value }) => {
      if (key.trim()) obj[key.trim()] = value;
    });
    onChange(obj);
  };

  const setRow = (i, field, val) => {
    const next = entries.map((e, idx) => (idx === i ? { ...e, [field]: val } : e));
    push(next);
  };

  const addRow = () => push([...entries, { key: '', value: '' }]);
  const removeRow = (i) => push(entries.filter((_, idx) => idx !== i));

  return (
    <div>
      {entries.map((row, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
          <TextInput
            placeholder="variable_name"
            value={row.key}
            onChange={(v) => setRow(i, 'key', v)}
            style={{ flex: 1 }}
          />
          <div style={{ flex: 2, position: 'relative' }}>
            <TextInput
              type={showValues[i] ? 'text' : 'password'}
              placeholder="value"
              value={row.value}
              onChange={(v) => setRow(i, 'value', v)}
              style={{ width: '100%', paddingRight: 70 }}
            />
            <Button
              variant="plain"
              onClick={() => setShowValues((s) => ({ ...s, [i]: !s[i] }))}
              style={{ position: 'absolute', right: 32, top: 0, height: '100%' }}
              title={showValues[i] ? 'Hide' : 'Show'}
            >
              {showValues[i] ? '🙈' : '👁'}
            </Button>
          </div>
          <Button variant="plain" onClick={() => removeRow(i)} title="Remove">
            <TrashIcon />
          </Button>
        </div>
      ))}
      <Button variant="link" icon={<PlusCircleIcon />} onClick={addRow}>
        Add variable
      </Button>
    </div>
  );
}

function Vaults() {
  const [vaults, setVaults] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [generateTarget, setGenerateTarget] = useState(null);
  const [generateResult, setGenerateResult] = useState(null);
  const [projects, setProjects] = useState([]);
  const [generateProjectId, setGenerateProjectId] = useState('');
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const { isLoading, error: loadError, request: fetchVaults } = useRequest(
    useCallback(async () => {
      const { data } = await listVaults();
      setVaults(data.results || []);
    }, []),
    { isLoading: true }
  );

  useEffect(() => {
    fetchVaults();
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) =>
      setProjects(data.results || [])
    ).catch(() => {});
  }, [fetchVaults]);

  const filtered = vaults.filter(
    (v) =>
      !search ||
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.description.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => setEditing({ ...EMPTY_FORM });
  const openEdit = (v) =>
    setEditing({ id: v.id, name: v.name, description: v.description, variables: v.variables || {} });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing.id) {
        const { data } = await updateVault(editing.id, {
          description: editing.description,
          variables: editing.variables,
        });
        setVaults((prev) => prev.map((v) => (v.id === editing.id ? { ...v, ...data } : v)));
      } else {
        const { data } = await createVault({
          name: editing.name,
          description: editing.description,
          variables: editing.variables,
        });
        setVaults((prev) => [...prev, data]);
      }
      setEditing(null);
    } catch (e) {
      setError(e?.response?.data?.detail || JSON.stringify(e?.response?.data) || e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this vault and its AWX credential?')) return;
    try {
      await deleteVault(id);
      setVaults((prev) => prev.filter((v) => v.id !== id));
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e?.response?.data?.detail || e.message);
    }
  };

  const openGenerate = (v) => {
    setGenerateTarget(v);
    setGenerateResult(null);
    setGenerateProjectId('');
    setGenerateError(null);
  };

  const doGenerate = async () => {
    setGenerateBusy(true);
    setGenerateError(null);
    try {
      const { data } = await generateVaultFile(generateTarget.id, generateProjectId || null);
      setGenerateResult(data);
    } catch (e) {
      setGenerateError(e?.response?.data?.detail || e.message);
    } finally {
      setGenerateBusy(false);
    }
  };

  const downloadFile = (filename, content) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <ScreenHeader
        streamType="vault"
        breadcrumbConfig={{ '/vaults': 'Vaults' }}
        title="Vaults"
      />
      <PageSection>
        <Card>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <SearchInput
                    placeholder="Filter by name…"
                    value={search}
                    onChange={(_, v) => setSearch(v)}
                    onClear={() => setSearch('')}
                  />
                </ToolbarItem>
                <ToolbarItem>
                  <Button variant="primary" onClick={openCreate}>
                    Add vault
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {isLoading && <Spinner size="lg" />}
            {loadError && <Alert variant="danger" title={String(loadError)} />}

            {!isLoading && (
              <TableComposable aria-label="Vaults" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Name / Vault-ID</Th>
                    <Th>Variables</Th>
                    <Th>Description</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.length === 0 && (
                    <Tr>
                      <Td colSpan={4}>No vaults configured.</Td>
                    </Tr>
                  )}
                  {filtered.map((v) => (
                    <Tr key={v.id}>
                      <Td>
                        <strong>{v.name}</strong>
                        <br />
                        <span style={{ fontSize: 11, color: '#666' }}>vault-id: {v.vault_id}</span>
                      </Td>
                      <Td>{v.variable_count ?? Object.keys(v.variables || {}).length}</Td>
                      <Td>{v.description}</Td>
                      <Td>
                        <Button variant="link" onClick={() => openEdit(v)}>Edit</Button>
                        {' '}
                        <Button variant="link" onClick={() => openGenerate(v)}>Generate</Button>
                        {' '}
                        <Button variant="link" isDanger onClick={() => remove(v.id)}>Delete</Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </TableComposable>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {/* Create / Edit modal */}
      {editing && (
        <Modal
          title={editing.id ? `Edit vault: ${editing.name}` : 'Add vault'}
          isOpen
          variant="large"
          onClose={() => setEditing(null)}
          actions={[
            <Button key="save" variant="primary" onClick={save} isDisabled={!editing.name || busy}>
              {busy ? <Spinner size="sm" /> : 'Save'}
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setEditing(null)}>Cancel</Button>,
          ]}
        >
          {error && <Alert variant="danger" title={error} style={{ marginBottom: 16 }} />}
          <Alert
            variant="info"
            isInline
            title="Usage"
            style={{ marginBottom: 16 }}
          >
            After saving, click <strong>Generate</strong> to write the encrypted vault file into
            your project. Then add to your playbook:
            <pre style={{ margin: '8px 0 0', fontSize: 12 }}>
              {'vars_files:\n  - vault-' + (editing.name || '<name>') + '.yml'}
            </pre>
            The vault password is auto-generated and injected automatically at job runtime.
          </Alert>
          <Form>
            <FormGroup label="Vault name (= vault-id)" isRequired>
              <TextInput
                isRequired
                value={editing.name}
                onChange={(v) => setEditing((s) => ({ ...s, name: v }))}
                isDisabled={!!editing.id}
                placeholder="my-vault"
              />
            </FormGroup>
            <FormGroup label="Description">
              <TextArea
                value={editing.description}
                onChange={(v) => setEditing((s) => ({ ...s, description: v }))}
                rows={2}
              />
            </FormGroup>
            <FormGroup label="Variables">
              <VaultVariableEditor
                variables={editing.variables}
                onChange={(vars) => setEditing((s) => ({ ...s, variables: vars }))}
              />
            </FormGroup>
          </Form>
        </Modal>
      )}

      {/* Generate vault file modal */}
      {generateTarget && (
        <Modal
          title={`Generate vault file: ${generateTarget.name}`}
          isOpen
          variant="large"
          onClose={() => { setGenerateTarget(null); setGenerateResult(null); }}
          actions={generateResult ? [
            <Button
              key="dl"
              variant="primary"
              onClick={() => downloadFile(generateResult.filename, generateResult.content)}
            >
              Download {generateResult.filename}
            </Button>,
            <Button key="close" variant="link" onClick={() => { setGenerateTarget(null); setGenerateResult(null); }}>
              Close
            </Button>,
          ] : [
            <Button key="gen" variant="primary" onClick={doGenerate} isDisabled={generateBusy}>
              {generateBusy ? <Spinner size="sm" /> : 'Generate'}
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setGenerateTarget(null)}>Cancel</Button>,
          ]}
        >
          {generateError && <Alert variant="danger" title={generateError} style={{ marginBottom: 16 }} />}

          {!generateResult && (
            <Form>
              <Alert variant="info" isInline title="How this works">
                awx-ng encrypts the vault variables with <code>ansible-vault</code> using a
                generated password. The vault file is saved to the selected project directory.
                AWX injects the vault credential automatically when a job runs.
              </Alert>
              <FormGroup label="Write to project directory (optional)">
                <select
                  value={generateProjectId}
                  onChange={(e) => setGenerateProjectId(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">— download only (do not write to disk) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </FormGroup>
            </Form>
          )}

          {generateResult && (
            <>
              <Alert variant="success" isInline title={`Generated: ${generateResult.filename}`} style={{ marginBottom: 12 }}>
                {generateResult.written_to
                  ? `Written to: ${generateResult.written_to}`
                  : 'Not written to disk — download the file below.'}
              </Alert>
              <p style={{ marginBottom: 8 }}>Add to your playbook:</p>
              <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied!">
                {generateResult.usage}
              </ClipboardCopy>
              <p style={{ marginTop: 16, marginBottom: 8 }}>Encrypted vault file preview:</p>
              <CodeBlock>
                <CodeBlockCode>{generateResult.content.slice(0, 300)}{generateResult.content.length > 300 ? '\n...' : ''}</CodeBlockCode>
              </CodeBlock>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export default Vaults;
