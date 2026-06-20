/* eslint-disable i18next/no-literal-string */
// awx-ng: File editor for Ansible playbooks and roles — VS Code-style 2-panel editor
// with file tree, Monaco YAML editor, and YAML linter.
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
  Modal,
  PageSection,
  Spinner,
  Text,
  TextInput,
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
import { useLocation } from 'react-router-dom';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import {
  deleteProjectFile,
  listProjectFiles,
  lintProjectFile,
  readProjectFile,
  readProjects,
  renameProjectFile,
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

function FileTreeNode({ projectId, entry, depth = 0, onSelect, onContextMenu, selectedPath, dirtyPath }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);

  const indent = depth * 16;
  const isSelected = selectedPath === entry.path;
  const isDirtyFile = entry.type === 'file' && entry.path === dirtyPath;

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
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(entry, e); }}
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
        {isDirtyFile && (
          <span style={{ color: '#795600', marginLeft: 5, fontSize: 10 }} title="Unsaved changes">●</span>
        )}
        {loading && <Spinner size="sm" style={{ marginLeft: 6 }} />}
      </div>
      {open && children && children.map((child) => (
        <FileTreeNode
          key={child.path}
          projectId={projectId}
          entry={child}
          depth={depth + 1}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          selectedPath={selectedPath}
          dirtyPath={dirtyPath}
        />
      ))}
    </div>
  );
}

function FileTree({ projectId, onSelect, onContextMenu, selectedPath, dirtyPath, refreshKey }) {
  const [roots, setRoots] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!projectId) { setRoots(null); return; }
    setRoots(null);
    listProjectFiles(projectId, '')
      .then(({ data }) => setRoots(data.entries || []))
      .catch((e) => setErr(e?.response?.data?.detail || e.message));
  }, [projectId, refreshKey]);

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
          onContextMenu={onContextMenu}
          selectedPath={selectedPath}
          dirtyPath={dirtyPath}
        />
      ))}
    </div>
  );
}

// ── LintPanel ─────────────────────────────────────────────────────────────────

function LintPanel({ errors, loading, active }) {
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
          {!active
            ? 'Lint — nicht verfügbar für diesen Dateityp'
            : loading
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

  // awx-ng: context menu + file operations
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }
  const [opModal, setOpModal] = useState(null); // { type: 'rename'|'newfile'|'newfolder'|'duplicate', entry, value }
  const [treeKey, setTreeKey] = useState(0); // increment to force tree reload

  const location = useLocation();
  const lintTimer = useRef(null);
  const deeplinkDone = useRef(false);
  const dirty = content !== savedContent;

  // Projekte laden
  useEffect(() => {
    readProjects({ page_size: 200, order_by: 'name' }).then(({ data }) => {
      setProjects(data.results || []);
      // Deep link (?project=&path=) takes precedence, otherwise the first project
      const params = new URLSearchParams(location.search);
      const qProject = params.get('project');
      if (qProject) setProjectId(String(qProject));
      else if (data.results?.length > 0) setProjectId(String(data.results[0].id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link: open the file from ?path= directly
  useEffect(() => {
    if (deeplinkDone.current) return;
    const params = new URLSearchParams(location.search);
    const qProject = params.get('project');
    const qPath = params.get('path');
    if (!qProject || !qPath) return;
    deeplinkDone.current = true;
    readProjectFile(qProject, qPath)
      .then(({ data }) => {
        setSelectedFile({ path: qPath, name: qPath.split('/').pop() });
        setContent(data.content);
        setSavedContent(data.content);
      })
      .catch(() => {});
  }, [location.search]);

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

  // Debounced Lint nach Änderung (800 ms) — only for YAML files
  const handleChange = useCallback(
    (newValue) => {
      setContent(newValue ?? '');
      if (!selectedFile) return;
      const isYaml = selectedFile.path.endsWith('.yml') || selectedFile.path.endsWith('.yaml');
      if (!isYaml) {
        setLintErrors([]);
        return;
      }
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

  // Save file; if a role defaults/vars file, backend auto-rescans the DB
  const save = useCallback(async () => {
    if (!selectedFile || !dirty) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const { data } = await saveProjectFile(projectId, selectedFile.path, content);
      setSavedContent(content);
      let successMsg = `Saved: ${selectedFile.path}`;
      const ri = data?.rescanned_role;
      if (ri) {
        successMsg += ri.error
          ? ` — role rescan error: ${ri.error}`
          : ` — role variables re-scanned: ${ri.role} (${ri.vars} vars)`;
      }
      setMsg(successMsg);
      setTimeout(() => setMsg(null), 5000);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  }, [projectId, selectedFile, content, dirty]);

  // awx-ng: file-tree context-menu operations
  const closeCtx = () => setContextMenu(null);

  const handleContextMenu = useCallback((entry, e) => {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const runOp = async () => {
    if (!opModal) return;
    const { type, entry, value } = opModal;
    setOpModal(null);
    setErr(null);
    try {
      if (type === 'rename') {
        const dir = entry.path.includes('/')
          ? entry.path.substring(0, entry.path.lastIndexOf('/') + 1)
          : '';
        await renameProjectFile(projectId, entry.path, dir + value.trim());
      } else if (type === 'newfile') {
        const parentPath = entry.type === 'dir' ? entry.path : entry.path.substring(0, entry.path.lastIndexOf('/'));
        const newPath = `${parentPath}/${value.trim()}`;
        await saveProjectFile(projectId, newPath, '');
        const { data } = await readProjectFile(projectId, newPath);
        setSelectedFile({ path: newPath, name: value.trim() });
        setContent(data.content);
        setSavedContent(data.content);
      } else if (type === 'newfolder') {
        const parentPath = entry.type === 'dir' ? entry.path : entry.path.substring(0, entry.path.lastIndexOf('/'));
        await saveProjectFile(projectId, `${parentPath}/${value.trim()}/.gitkeep`, '');
      } else if (type === 'duplicate') {
        const dir = entry.path.includes('/')
          ? entry.path.substring(0, entry.path.lastIndexOf('/') + 1)
          : '';
        const { data: src } = await readProjectFile(projectId, entry.path);
        await saveProjectFile(projectId, dir + value.trim(), src.content);
      }
      setMsg(`Done: ${type} — ${value.trim()}`);
      setTimeout(() => setMsg(null), 4000);
      setTreeKey((k) => k + 1);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  };

  const handleDelete = async (entry) => {
    closeCtx();
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${entry.path}"?`)) return;
    setErr(null);
    try {
      await deleteProjectFile(projectId, entry.path);
      if (selectedFile?.path === entry.path || selectedFile?.path?.startsWith(entry.path + '/')) {
        setSelectedFile(null);
        setContent('');
        setSavedContent('');
      }
      setTreeKey((k) => k + 1);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  };

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
        breadcrumbConfig={{ '/editor': 'Editor' }}
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
                onContextMenu={handleContextMenu}
                selectedPath={selectedFile?.path}
                dirtyPath={dirty ? selectedFile?.path : null}
                refreshKey={treeKey}
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
                  <LintPanel
                    errors={lintErrors}
                    loading={lintLoading}
                    active={selectedFile?.path.endsWith('.yml') || selectedFile?.path.endsWith('.yaml')}
                  />
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

      {/* ── Context menu ── */}
      {contextMenu && (
        <>
          {/* Invisible overlay to catch outside-clicks */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={closeCtx}
            onContextMenu={(e) => { e.preventDefault(); closeCtx(); }}
          />
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 9999,
              background: '#fff',
              border: '1px solid #d2d2d2',
              borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              minWidth: 160,
              padding: '4px 0',
            }}
          >
            {contextMenu.entry.type === 'dir' ? (
              <>
                <CtxItem label="New file here" onClick={() => { closeCtx(); setOpModal({ type: 'newfile', entry: contextMenu.entry, value: '' }); }} />
                <CtxItem label="New folder here" onClick={() => { closeCtx(); setOpModal({ type: 'newfolder', entry: contextMenu.entry, value: '' }); }} />
                <CtxDivider />
                <CtxItem label="Rename" onClick={() => { closeCtx(); setOpModal({ type: 'rename', entry: contextMenu.entry, value: contextMenu.entry.name }); }} />
                <CtxItem label="Delete folder" danger onClick={() => handleDelete(contextMenu.entry)} />
              </>
            ) : (
              <>
                <CtxItem label="Rename" onClick={() => { closeCtx(); setOpModal({ type: 'rename', entry: contextMenu.entry, value: contextMenu.entry.name }); }} />
                <CtxItem label="Duplicate" onClick={() => { closeCtx(); const n = contextMenu.entry.name; const dot = n.lastIndexOf('.'); const dupName = dot > 0 ? `${n.slice(0, dot)}-copy${n.slice(dot)}` : `${n}-copy`; setOpModal({ type: 'duplicate', entry: contextMenu.entry, value: dupName }); }} />
                <CtxDivider />
                <CtxItem label="Delete" danger onClick={() => handleDelete(contextMenu.entry)} />
              </>
            )}
          </div>
        </>
      )}

      {/* ── File-operation modal (rename / new file / new folder / duplicate) ── */}
      {opModal && (
        <Modal
          title={
            opModal.type === 'rename' ? `Rename: ${opModal.entry.name}` :
            opModal.type === 'newfile' ? 'New file' :
            opModal.type === 'newfolder' ? 'New folder' :
            `Duplicate: ${opModal.entry.name}`
          }
          isOpen
          variant="small"
          onClose={() => setOpModal(null)}
          actions={[
            <Button
              key="ok"
              variant="primary"
              isDisabled={!opModal.value.trim()}
              onClick={runOp}
            >
              {opModal.type === 'rename' ? 'Rename' : opModal.type === 'duplicate' ? 'Duplicate' : 'Create'}
            </Button>,
            <Button key="cancel" variant="link" onClick={() => setOpModal(null)}>
              Cancel
            </Button>,
          ]}
        >
          <TextInput
            autoFocus
            value={opModal.value}
            onChange={(v) => setOpModal({ ...opModal, value: typeof v === 'string' ? v : v?.target?.value ?? '' })}
            onKeyDown={(e) => { if (e.key === 'Enter' && opModal.value.trim()) runOp(); if (e.key === 'Escape') setOpModal(null); }}
            placeholder={
              opModal.type === 'newfile' ? 'filename.yml' :
              opModal.type === 'newfolder' ? 'folder-name' :
              'new-name'
            }
          />
        </Modal>
      )}
    </>
  );
}

// ── Small context-menu helper components ──────────────────────────────────────

function CtxItem({ label, onClick, danger }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 16px',
        fontSize: 13,
        cursor: 'pointer',
        color: danger ? '#c9190b' : '#151515',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f0f0'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </div>
  );
}

function CtxDivider() {
  return <div style={{ borderTop: '1px solid #e8e8e8', margin: '2px 0' }} />;
}
