/* eslint-disable i18next/no-literal-string */
// awx-ng: Templates tab for the Playbook Builder's role editor — manages
// roles/<name>/templates/*.j2 (Jinja2 files used by the `template` module's
// `src:` param). Deliberately NOT a Blockly section like Tasks/Handlers/
// Defaults/Vars: a role's templates/ directory holds an arbitrary NUMBER of
// arbitrarily-NAMED plain-text files, which doesn't fit the "exactly one
// fixed-name YAML file per section" shape the other 4 tabs share (see
// ROLE_SECTIONS/roleSectionPath in PlaybookBuilder.js) — so this is its own
// small file-list + text-editor pane instead, reusing the same Monaco
// YamlEditor (which already treats .j2/.jinja2 as Jinja/handlebars syntax)
// and file API as the standalone Editor screen (ProjectEditor.js), just
// scoped to one directory.
import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Spinner, TextInput } from '@patternfly/react-core';
import { TrashAltIcon } from '@patternfly/react-icons';
import { listProjectFiles, readProjectFile, saveProjectFile, deleteProjectFile } from '../api';

const YamlEditor = lazy(() => import('../YamlEditor'));

function templatesDir(roleName) {
  return `roles/${roleName}/templates`;
}

function TemplatesPanel({ projectId, roleName }) {
  const [entries, setEntries] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedPath, setSelectedPath] = useState(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = selectedPath !== null && content !== savedContent;

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const { data } = await listProjectFiles(projectId, templatesDir(roleName));
      setEntries((data.entries || []).filter((e) => e.type === 'file'));
    } catch {
      // Directory doesn't exist yet (role has no templates/ so far) — empty is fine.
      setEntries([]);
    } finally {
      setLoadingList(false);
    }
  }, [projectId, roleName]);

  useEffect(() => { loadList(); }, [loadList]);

  const selectFile = async (entry) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setSelectedPath(entry.path);
    setLoadingContent(true);
    setError(null);
    try {
      const { data } = await readProjectFile(projectId, entry.path);
      setContent(data.content);
      setSavedContent(data.content);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setLoadingContent(false);
    }
  };

  const createTemplate = async () => {
    const name = newFileName.trim();
    if (!name || !roleName) return;
    const path = `${templatesDir(roleName)}/${name}`;
    setSaving(true);
    setError(null);
    try {
      await saveProjectFile(projectId, path, '');
      setNewFileName('');
      await loadList();
      setSelectedPath(path);
      setContent('');
      setSavedContent('');
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = useCallback(async () => {
    if (!selectedPath) return;
    setSaving(true);
    setError(null);
    try {
      await saveProjectFile(projectId, selectedPath, content);
      setSavedContent(content);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  }, [projectId, selectedPath, content]);

  const removeTemplate = async (entry, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${entry.path}"?`)) return;
    try {
      await deleteProjectFile(projectId, entry.path);
      if (selectedPath === entry.path) {
        setSelectedPath(null);
        setContent('');
        setSavedContent('');
      }
      await loadList();
    } catch (e2) {
      setError(e2?.response?.data?.detail || e2.message);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ flex: '0 0 220px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <TextInput
            aria-label="New template filename"
            placeholder="new-template.conf.j2"
            value={newFileName}
            onChange={setNewFileName}
            data-testid="pb-new-template-name"
            onKeyDown={(e) => { if (e.key === 'Enter') createTemplate(); }}
          />
          <Button
            variant="secondary"
            isDisabled={!newFileName.trim() || saving}
            onClick={createTemplate}
            data-testid="pb-new-template-button"
          >
            +
          </Button>
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4 }} data-testid="pb-template-list">
          {loadingList && <Spinner size="md" style={{ margin: 12 }} />}
          {!loadingList && entries.length === 0 && (
            <p style={{ color: '#888', fontSize: 13, padding: 8 }}>
              No templates yet in {templatesDir(roleName)}/.
            </p>
          )}
          {entries.map((entry) => (
            <div
              key={entry.path}
              onClick={() => selectFile(entry)}
              data-testid="pb-template-item"
              data-path={entry.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                cursor: 'pointer',
                background: selectedPath === entry.path ? '#e8f1fb' : 'transparent',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <span style={{ fontSize: 13, fontFamily: 'monospace' }}>
                {entry.name}
                {selectedPath === entry.path && dirty && <span style={{ color: '#795600' }}> ●</span>}
              </span>
              <TrashAltIcon
                style={{ color: '#c9190b', cursor: 'pointer' }}
                onClick={(e) => removeTemplate(entry, e)}
                title="Delete"
              />
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {error && <Alert variant="danger" title={error} isInline style={{ marginBottom: 8 }} />}
        {!selectedPath ? (
          <p style={{ color: '#888', fontSize: 13 }}>
            Select a template on the left, or create a new one.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedPath}</span>
              <Button
                variant="primary"
                isDisabled={!dirty || saving}
                onClick={saveTemplate}
                data-testid="pb-save-template-button"
              >
                {saving ? <Spinner size="sm" /> : 'Save template'}
              </Button>
              {savedFlash && <span style={{ color: '#3e8635', fontSize: 13 }}>Saved.</span>}
            </div>
            <div style={{ flex: '1 1 auto', minHeight: 0 }}>
              {loadingContent ? (
                <Spinner size="md" style={{ margin: 20 }} />
              ) : (
                <Suspense fallback={<Spinner style={{ margin: 20 }} />}>
                  <YamlEditor
                    value={content}
                    onChange={(v) => setContent(v ?? '')}
                    path={selectedPath}
                    onSave={saveTemplate}
                    height="100%"
                  />
                </Suspense>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TemplatesPanel;
