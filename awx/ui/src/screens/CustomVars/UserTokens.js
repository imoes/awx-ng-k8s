/* eslint-disable i18next/no-literal-string */
// API token management — create/delete personal OAuth2 tokens.
// One token works for both /api/v2/ (Authorization: Bearer <token>) and /mcp.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  ClipboardCopy,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  Modal,
  PageSection,
  Spinner,
  TextArea,
  TextInput,
  Title,
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
import { createToken, deleteToken, listMyTokens, readMe } from './api';

function fmt(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const far = new Date('3000-01-01');
  if (d > far) return 'never';
  return d.toLocaleString();
}

export default function UserTokens() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('write');
  const [creating, setCreating] = useState(false);

  // Newly created token display
  const [newToken, setNewToken] = useState(null); // { id, token, description, scope, expires }

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await listMyTokens();
      setTokens(data.results || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setDescription('');
    setScope('write');
    setCreateOpen(true);
  };

  const doCreate = async () => {
    setCreating(true);
    setErr(null);
    try {
      const { data } = await createToken({ description, scope });
      setNewToken({
        id: data.id,
        token: data.token,
        description: data.description,
        scope: data.scope,
        expires: data.expires,
      });
      setCreateOpen(false);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setCreating(false);
    }
  };

  const doDelete = async (tokenId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this token? This cannot be undone.')) return;
    setErr(null);
    try {
      await deleteToken(tokenId);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  };

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{ '/tokens': 'API Tokens' }}
      />
      <PageSection>
        <Card>
          <CardBody>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Title headingLevel="h2" size="lg">Personal API Tokens</Title>
              <Button variant="primary" onClick={openCreate}>Create Token</Button>
            </div>

            <Alert variant="info" isInline style={{ marginBottom: 16 }}>
              Tokens work for both the REST API (<code>Authorization: Bearer &lt;token&gt;</code> on
              {' '}<code>/api/v2/</code>) and the MCP server (<code>/mcp</code>).
              The token value is shown <strong>only once</strong> at creation time.
            </Alert>

            {err && (
              <Alert variant="danger" title="Error" isInline style={{ marginBottom: 8 }}>
                {err}
              </Alert>
            )}

            {loading ? (
              <Spinner />
            ) : (
              <TableComposable aria-label="API Tokens" variant="compact">
                <Thead>
                  <Tr>
                    <Th>ID</Th>
                    <Th>Description</Th>
                    <Th>Scope</Th>
                    <Th>Created</Th>
                    <Th>Expires</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {tokens.length === 0 ? (
                    <Tr>
                      <Td colSpan={6} style={{ color: '#6a6e73' }}>
                        No tokens yet. Create one to authenticate API and MCP requests.
                      </Td>
                    </Tr>
                  ) : (
                    tokens.map((tok) => (
                      <Tr key={tok.id}>
                        <Td dataLabel="ID">{tok.id}</Td>
                        <Td dataLabel="Description">{tok.description || <span style={{ color: '#6a6e73' }}>—</span>}</Td>
                        <Td dataLabel="Scope">
                          <Label isCompact color={tok.scope === 'write' ? 'blue' : 'grey'}>
                            {tok.scope}
                          </Label>
                        </Td>
                        <Td dataLabel="Created">{fmt(tok.created)}</Td>
                        <Td dataLabel="Expires">{fmt(tok.expires)}</Td>
                        <Td dataLabel="Actions">
                          <Button
                            variant="link"
                            isDanger
                            isInline
                            onClick={() => doDelete(tok.id)}
                          >
                            Delete
                          </Button>
                        </Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </TableComposable>
            )}
          </CardBody>
        </Card>
      </PageSection>

      {/* ── Create token modal ── */}
      {createOpen && (
        <Modal
          title="Create API Token"
          isOpen
          variant="small"
          onClose={() => setCreateOpen(false)}
          actions={[
            <Button
              key="create"
              variant="primary"
              isDisabled={creating}
              isLoading={creating}
              onClick={doCreate}
            >
              {creating ? 'Creating…' : 'Create'}
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>,
          ]}
        >
          <Form>
            <FormGroup label="Description" fieldId="tok-desc">
              <TextInput
                id="tok-desc"
                value={description}
                onChange={(v) => setDescription(typeof v === 'string' ? v : v?.target?.value ?? '')}
                placeholder="e.g. Claude Code MCP access"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Scope" fieldId="tok-scope">
              <FormSelect
                id="tok-scope"
                value={scope}
                onChange={(v) => setScope(v)}
              >
                <FormSelectOption value="write" label="write — read + write access" />
                <FormSelectOption value="read" label="read — read-only access" />
              </FormSelect>
            </FormGroup>
          </Form>
        </Modal>
      )}

      {/* ── New token display modal (shown once after creation) ── */}
      {newToken && (
        <Modal
          title="Token created — save it now"
          isOpen
          variant="medium"
          onClose={() => setNewToken(null)}
          actions={[
            <Button key="close" variant="primary" onClick={() => setNewToken(null)}>
              Done
            </Button>,
          ]}
        >
          <Alert variant="warning" isInline style={{ marginBottom: 16 }}>
            This token value is shown <strong>only once</strong>.
            Copy it now — it cannot be retrieved again.
          </Alert>

          <FormGroup label="Token" fieldId="new-tok-value" style={{ marginBottom: 16 }}>
            <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied!">
              {newToken.token}
            </ClipboardCopy>
          </FormGroup>

          <p style={{ marginBottom: 8, fontWeight: 600 }}>Usage examples:</p>
          <TextArea
            isReadOnly
            rows={5}
            value={[
              `# AWX REST API`,
              `curl -H "Authorization: Bearer ${newToken.token}" http://localhost:8052/api/v2/me/`,
              ``,
              `# MCP Server`,
              `curl -X POST http://localhost:8052/mcp \\`,
              `  -H "Authorization: Bearer ${newToken.token}" \\`,
              `  -H "Content-Type: application/json" \\`,
              `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
            ].join('\n')}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
            aria-label="Usage examples"
          />

          <div style={{ marginTop: 12, color: '#6a6e73', fontSize: 13 }}>
            Scope: <strong>{newToken.scope}</strong> ·
            Expires: <strong>{fmt(newToken.expires)}</strong> ·
            Description: <strong>{newToken.description || '—'}</strong>
          </div>
        </Modal>
      )}
    </>
  );
}
