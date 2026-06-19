/* eslint-disable i18next/no-literal-string */
// awx-ng: Playbook / Rollen-Editor — VS Code-artiger 2-Panel-Editor mit YAML-Linter.
import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
  Spinner,
  Text,
  TextVariants,
  Title,
} from '@patternfly/react-core';
import {
  AngleDownIcon,
  AngleRightIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  FolderOpenIcon,
  SaveAltIcon,
} from '@patternfly/react-icons';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import {
  listProjectFiles,
  lintProjectFile,
  readProjectFile,
  readProjects,
  saveProjectFile,
} from './api';

// Monaco lazy-loaded — ~4 MB nur wenn Screen aktiv
const YamlEditor = lazy(() => import('./YamlEditor'));

// ── FileTree ──────────────────────────────────────────────────────────────────

function FileIcon({ suffix }) {
  const codeExts = ['.yml', '.yaml', '.j2', '.jinja2', '.conf', '.ini', '.cfg'];
  if (codeExts.includes(suffix)) {
    return <span style={{ marginRight: 4, fontSize: 11, color: '#0066cc' }}>⬡</span>;
  }
  return <span style={{ marginRight: 4, fontSize: 11, color: '#6a6e73' }}>·</span>;
}

function FileTreeNode({ projectId, entry, depth = 0, onSelect, selectedPath }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);

  const indent = depth * 16;
  const isSelected = selectedPath === entry.path;

  const toggle = async () => {
    if (entry.type === 'file') {
      onSelect(entry);
      return;
    }
    if (!open && children === null) {
      setLoading(true);
      try {
        const { data } = await listProjectFiles(projectId, entry.path);
        setChildren(data.entries || []);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setOpen((o) => !o);
  };

  return (
    <div>
      <div
        onClick={toggle}
        style={{
          paddingLeft: indent + 8,
          paddingTop: 3,
          paddingBottom: 3,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          background: isSelected ? '#e8f1fb' : 'transparent',
          borderRadius: 3,
          userSelect: 'none',
        }}
      >
        {entry.type === 'dir' ? (
          <>
            {open ? (
              <AngleDownIcon style={{ marginRight: 4, fontSize: 10, color: '#6a6e73' }} />
            ) : (
              <AngleRightIcon style={{ marginRight: 4, fontSize: 10, color: '#6a6e73' }} />
            )}
            {open ? (
              <FolderOpenIcon style={{ marginRight: 6, color: '#f0ab00' }} />
            ) : (
              <FolderIcon style={{ marginRight: 6, color: '#f0ab00' }} />
            )}
          </>
        ) : (
          <>
            <span style={{ marginRight: 14 }} />
            <FileIcon suffix={entry.suffix} />
          </>
        )}
        <span style={{ fontSize: 13, color: isSelected ? '#0066cc' : '#151515' }}>
          {entry.name}
        </span>
        {loading && <Spinner size="sm" style={{ marginLeft: 6 }} />}
      </div>
      {open && children && children.map((child) => (
        <FileTreeNode
          key={child.path}
          projectId={projectId}
          entry={child}
          depth={depth + 1}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

function FileTree({ projectId, onSelect, selectedPath }) {
  const [roots, setRoots] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!projectId) { setRoots(null); return; }
    setRoots(null);
    listProjectFiles(projectId, '')
      .then(({ data }) => setRoots(data.entries || []))
      .catch((e) => setErr(e?.response?.data?.detail || e.message));
  }, [projectId]);

  if (err) return <p style={{ color: 'red', padding: 8, fontSize: 12 }}>{err}</p>;
  if (!projectId) return <p style={{ color: '#6a6e73', padding: 8, fontSize: 12 }}>Projekt wählen…</p>;
  if (roots === null) return <Spinner size="md" style={{ margin: 12 }} />;
  if (roots.length === 0) return <p style={{ color: '#6a6e73', padding: 8, fontSize: 12 }}>Keine Dateien.</p>;

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {roots.map((entry) => (
        <FileTreeNode
          key={entry.path}
          projectId={projectId}
          entry={entry}
          depth={0}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

// ── LintPanel ─────────────────────────────────────────────────────────────────

function LintPanel({ errors, loading }) {
  const [collapsed, setCollapsed] = useState(false);

  const errorCount = errors.filter((e) => e.severity === 'error').length;
  const warnCount = errors.filter((e) => e.severity !== 'error').length;

  const statusColor = errorCount > 0 ? '#c9190b' : warnCount > 0 ? '#795600' : '#1e7e34';
  const StatusIcon = errorCount > 0
    ? ExclamationCircleIcon
    : warnCount > 0
    ? ExclamationTriangleIcon
    : CheckCircleIcon;

  return (
    <div
      style={{
        borderTop: '1px solid #d2d2d2',
        background: '#f0f0f0',
        minHeight: 32,
      }}
    >
      {/* Header */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 12px',
          cursor: 'pointer',
          fontSize: 12,
          color: '#151515',
        }}
      >
        {collapsed ? <AngleRightIcon /> : <AngleDownIcon />}
        <StatusIcon style={{ color: statusColor }} />
        <span>
          {loading
            ? 'Lint läuft…'
            : errors.length === 0
            ? 'YAML valid — keine Fehler'
            : `${errorCount} Fehler, ${warnCount} Warnungen`}
        </span>
        {loading && <Spinner size="sm" />}
      </div>

      {/* Error list */}
      {!collapsed && errors.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', padding: '0 8px 8px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6a6e73' }}>
                <th style={{ textAlign: 'left', padding: '2px 8px', width: 50 }}>Zeile</th>
                <th style={{ textAlign: 'left', padding: '2px 8px', width: 50 }}>Sp.</th>
                <th style={{ textAlign: 'left', padding: '2px 8px', width: 70 }}>Typ</th>
                <th style={{ textAlign: 'left', padding: '2px 8px' }}>Nachricht</th>
                <th style={{ textAlign: 'left', padding: '2px 8px', width: 80 }}>Quelle</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 0 ? '#fff' : '#fafafa',
                    color: e.severity === 'error' ? '#c9190b' : '#795600',
                  }}
                >
                  <td style={{ padding: '2px 8px', fontWeight: 600 }}>{e.line}</td>
                  <td style={{ padding: '2px 8px' }}>{e.col}</td>
                  <td style={{ padding: '2px 8px' }}>
                    <Label
                      color={e.severity === 'error' ? 'red' : 'orange'}
                      isCompact
                    >
                      {e.severity}
                    </Label>
                  </td>
                  <td style={{ padding: '2px 8px', fontFamily: 'monospace' }}>{e.message}</td>
                  <td style={{ padding: '2px 8px', color: '#6a6e73' }}>{e.source || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── ProjectEditor ─────────────────────────────────────────────────────────────

export default function ProjectEditor() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');

  // Editor state
  const [selectedFile, setSelectedFile] = useState(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [lintErrors, setLintErrors] = useState([]);
  const [lintLoading, setLintLoading] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const lintTimer = useRef(null);
  const dirty = content !== savedContent;

  // Projekte laden
  useEffect(() => {
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) => {
      setProjects(data.results || []);
      if (data.results?.length > 0) setProjectId(String(data.results[0].id));
    });
  }, []);

  // Datei öffnen
  const openFile = useCallback(
    async (entry) => {
      if (dirty) {
        // eslint-disable-next-line no-alert
        if (!window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
      }
      setLoading(true);
      setErr(null);
      setLintErrors([]);
      try {
        const { data } = await readProjectFile(projectId, entry.path);
        setSelectedFile(entry);
        setContent(data.content);
        setSavedContent(data.content);
      } catch (e) {
        setErr(e?.response?.data?.detail || e.message);
      } finally {
        setLoading(false);
      }
    },
    [projectId, dirty]
  );

  // Debounced Lint nach Änderung (800 ms)
  const handleChange = useCallback(
    (newValue) => {
      setContent(newValue ?? '');
      if (!selectedFile) return;
      clearTimeout(lintTimer.current);
      lintTimer.current = setTimeout(async () => {
        setLintLoading(true);
        try {
          const { data } = await lintProjectFile(
            projectId,
            newValue ?? '',
            selectedFile.path
          );
          setLintErrors(data.errors || []);
        } catch {
          setLintErrors([]);
        } finally {
          setLintLoading(false);
        }
      }, 800);
    },
    [projectId, selectedFile]
  );

  // Datei speichern
  const save = useCallback(async () => {
    if (!selectedFile || !dirty) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await saveProjectFile(projectId, selectedFile.path, content);
      setSavedContent(content);
      setMsg(`Gespeichert: ${selectedFile.path}`);
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  }, [projectId, selectedFile, content, dirty]);

  // Browser-Tab schließen warnen bei ungespeicherten Änderungen
  useEffect(() => {
    const handler = (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{ '/editor': 'Playbook Editor' }}
      />
      <PageSection style={{ padding: 0, height: 'calc(100vh - 120px)' }}>
        <Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* ── Toolbar ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 16px',
              borderBottom: '1px solid #d2d2d2',
              flexShrink: 0,
            }}
          >
            <FormGroup fieldId="pe-project" style={{ margin: 0 }}>
              <FormSelect
                id="pe-project"
                value={projectId}
                onChange={(v) => {
                  setProjectId(v);
                  setSelectedFile(null);
                  setContent('');
                  setSavedContent('');
                  setLintErrors([]);
                }}
                style={{ minWidth: 220 }}
              >
                {projects.map((p) => (
                  <FormSelectOption key={p.id} value={String(p.id)} label={p.name} />
                ))}
              </FormSelect>
            </FormGroup>

            {selectedFile && (
              <Text
                component={TextVariants.small}
                style={{ color: '#6a6e73', flex: 1, fontFamily: 'monospace' }}
              >
                {selectedFile.path}
                {dirty && (
                  <Label color="orange" isCompact style={{ marginLeft: 8 }}>
                    unsaved
                  </Label>
                )}
              </Text>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button
                variant="primary"
                icon={<SaveAltIcon />}
                onClick={save}
                isDisabled={!dirty || saving}
                isLoading={saving}
              >
                {saving ? 'Speichern…' : 'Save'}
              </Button>
            </div>
          </div>

          {/* Messages */}
          {msg && (
            <Alert variant="success" title={msg} isInline style={{ flexShrink: 0 }} />
          )}
          {err && (
            <Alert variant="danger" title={err} isInline style={{ flexShrink: 0 }} />
          )}

          {/* ── Body: FileTree | Editor ── */}
          <CardBody
            style={{
              flex: 1,
              display: 'flex',
              padding: 0,
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {/* File Tree */}
            <div
              style={{
                width: 260,
                flexShrink: 0,
                borderRight: '1px solid #d2d2d2',
                background: '#fafafa',
                overflowY: 'auto',
                padding: '8px 4px',
              }}
            >
              <Title headingLevel="h4" size="sm" style={{ padding: '0 8px 6px', color: '#6a6e73' }}>
                Files
              </Title>
              <FileTree
                projectId={projectId}
                onSelect={openFile}
                selectedPath={selectedFile?.path}
              />
            </div>

            {/* Editor + LintPanel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
                  <Spinner />
                </div>
              ) : selectedFile ? (
                <>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <Suspense fallback={<Spinner style={{ margin: 20 }} />}>
                      <YamlEditor
                        value={content}
                        onChange={handleChange}
                        path={selectedFile.path}
                        lintErrors={lintErrors}
                        onSave={save}
                        height="100%"
                      />
                    </Suspense>
                  </div>
                  <LintPanel errors={lintErrors} loading={lintLoading} />
                </>
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6a6e73',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 48 }}>📄</span>
                  <Text>Datei im Baum links auswählen zum Bearbeiten</Text>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}
