/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import {
  Alert,
  Button,
  FormGroup,
  PageSection,
  Card,
  CardBody,
  Spinner,
  TextInput,
  Title,
} from '@patternfly/react-core';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import CodeEditor from 'components/CodeEditor';
import useRequest from 'hooks/useRequest';
import BlocklyWorkspace from './BlocklyWorkspace';
import { registerBlocks } from './blocks';
import { buildToolbox } from './toolbox';
import { workspaceToPlaybook } from './ansibleGenerator';
import { importPlaybookYaml } from './playbookImporter';
import { sidecarPathFor } from './sidecarPath';
import { insertVariableReference } from './varInsertion';
import VariablesPanel from './VariablesPanel';
import { readProjects, readProjectRoles, readProjectFile, saveProjectFile, lintProjectFile } from '../api';

// Finds the Blockly text field rendered under the given viewport coordinates
// — used to resolve where a dragged variable should be inserted. Blockly
// doesn't expose a ready-made "field at point" API, but every field's SVG
// group is a real DOM node we can hit-test with getBoundingClientRect().
function findFieldAtPoint(workspace, clientX, clientY) {
  const blocks = workspace.getAllBlocks(false);
  for (let i = 0; i < blocks.length; i += 1) {
    const { inputList } = blocks[i];
    for (let j = 0; j < inputList.length; j += 1) {
      const { fieldRow } = inputList[j];
      for (let k = 0; k < fieldRow.length; k += 1) {
        const field = fieldRow[k];
        if (!(field instanceof Blockly.FieldTextInput)) continue;
        const svgRoot = field.getSvgRoot ? field.getSvgRoot() : null;
        if (!svgRoot) continue;
        const rect = svgRoot.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return field;
        }
      }
    }
  }
  return null;
}

function PlaybookBuilder() {
  const [blockCount, setBlockCount] = useState(0);
  const [playbookYaml, setPlaybookYaml] = useState('---\n');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [targetPath, setTargetPath] = useState('playbooks/blockly-test.yml');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [lintErrors, setLintErrors] = useState([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadMessage, setLoadMessage] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState(null);
  const workspaceRef = useRef(null);

  // Block definitions must be registered before Blockly.inject runs; do it
  // once per mount, not on every render. The Roles category starts empty —
  // it's populated once a project is selected (see loadRoles below), via
  // workspace.updateToolbox(), since roles are per-project.
  const toolbox = useMemo(() => {
    registerBlocks();
    return buildToolbox([]);
  }, []);

  const { request: loadProjects } = useRequest(
    useCallback(async () => {
      const { data } = await readProjects({ page_size: 200, order_by: 'name' });
      setProjects(data.results || []);
      if (data.results?.length) setProjectId(String(data.results[0].id));
    }, [])
  );
  useEffect(() => { loadProjects(); }, [loadProjects]);

  const { request: loadRoles } = useRequest(
    useCallback(async () => {
      if (!projectId) return;
      const { data } = await readProjectRoles(projectId);
      const roleNames = (data.results || []).map((r) => r.role_name);
      workspaceRef.current?.updateToolbox(buildToolbox(roleNames));
    }, [projectId])
  );
  useEffect(() => { loadRoles(); }, [loadRoles]);

  const handleChange = (workspace) => {
    setBlockCount(workspace.getAllBlocks(false).length);
    setPlaybookYaml(workspaceToPlaybook(workspace));
  };

  const handleWorkspaceReady = (ws) => {
    workspaceRef.current = ws;
    // Wires the VariablesPanel's HTML5 drag-and-drop onto the Blockly
    // canvas: dropping a variable chip over a text field inserts a
    // {{ name }} reference into that field.
    const svgRoot = ws.getParentSvg();
    svgRoot.addEventListener('dragover', (event) => event.preventDefault());
    svgRoot.addEventListener('drop', (event) => {
      event.preventDefault();
      const varName = event.dataTransfer.getData('text/plain');
      if (!varName) return;
      const field = findFieldAtPoint(ws, event.clientX, event.clientY);
      if (field) {
        insertVariableReference(field, varName);
        handleChange(ws);
      }
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setLintErrors([]);
    setSaved(false);
    try {
      const { data: lintResult } = await lintProjectFile(projectId, playbookYaml, targetPath);
      if (!lintResult.valid) {
        setLintErrors(lintResult.errors || []);
        return;
      }
      await saveProjectFile(projectId, targetPath, playbookYaml);
      // Persist the visual layout alongside the generated YAML so the
      // builder can be reopened later (Section F) without losing the
      // block arrangement — regenerating YAML from scratch would work,
      // but re-editing requires the original block tree.
      const workspaceState = Blockly.serialization.workspaces.save(workspaceRef.current);
      await saveProjectFile(projectId, sidecarPathFor(targetPath), JSON.stringify(workspaceState));
      setSaved(true);
    } catch (e) {
      setSaveError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async () => {
    setLoading(true);
    setLoadMessage(null);
    setSaveError(null);
    try {
      const { data } = await readProjectFile(projectId, sidecarPathFor(targetPath));
      const workspace = workspaceRef.current;
      workspace.clear();
      Blockly.serialization.workspaces.load(JSON.parse(data.content), workspace);
      handleChange(workspace);
      setLoadMessage({ variant: 'success', text: 'Layout loaded from sidecar.' });
    } catch (e) {
      if (e?.response?.status === 404) {
        setLoadMessage({ variant: 'info', text: 'No saved layout found for this path yet.' });
      } else {
        setLoadMessage({ variant: 'danger', text: e?.response?.data?.detail || e.message });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImportYaml = async () => {
    setImporting(true);
    setImportMessage(null);
    setSaveError(null);
    try {
      const { data } = await readProjectFile(projectId, targetPath);
      const count = importPlaybookYaml(data.content, workspaceRef.current);
      handleChange(workspaceRef.current);
      setImportMessage({ variant: 'success', text: `Imported ${count} play(s) from ${targetPath}.` });
    } catch (e) {
      if (e?.response?.status === 404) {
        setImportMessage({ variant: 'info', text: 'File not found at this path.' });
      } else {
        setImportMessage({ variant: 'danger', text: e?.response?.data?.detail || e.message });
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <ScreenHeader
        streamType="playbook_builder"
        breadcrumbConfig={{ '/playbook-builder': 'Playbook Builder' }}
        title="Playbook Builder"
      />
      <PageSection>
        <Card>
          <CardBody>
            <Title headingLevel="h2" size="md" style={{ marginBottom: 12 }}>
              Playbook Builder
            </Title>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-end' }}>
              <FormGroup label="Project" style={{ minWidth: 220 }}>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4 }}
                  data-testid="pb-project-select"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </FormGroup>
              <FormGroup label="Target path" style={{ minWidth: 300 }}>
                <TextInput
                  value={targetPath}
                  onChange={setTargetPath}
                  data-testid="pb-target-path"
                />
              </FormGroup>
              <Button
                variant="primary"
                onClick={handleSave}
                isDisabled={saving || !projectId}
                data-testid="pb-save-button"
              >
                {saving ? <Spinner size="sm" /> : 'Lint & Save'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleLoad}
                isDisabled={loading || !projectId}
                data-testid="pb-load-button"
              >
                {loading ? <Spinner size="sm" /> : 'Load layout'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleImportYaml}
                isDisabled={importing || !projectId}
                data-testid="pb-import-button"
              >
                {importing ? <Spinner size="sm" /> : 'Import from YAML'}
              </Button>
            </div>

            {saveError && <Alert variant="danger" title={saveError} isInline style={{ marginBottom: 12 }} />}
            {saved && <Alert variant="success" title={`Saved to ${targetPath}`} isInline style={{ marginBottom: 12 }} />}
            {loadMessage && (
              <Alert
                variant={loadMessage.variant}
                title={loadMessage.text}
                isInline
                style={{ marginBottom: 12 }}
                data-testid="pb-load-message"
              />
            )}
            {importMessage && (
              <Alert
                variant={importMessage.variant}
                title={importMessage.text}
                isInline
                style={{ marginBottom: 12 }}
                data-testid="pb-import-message"
              />
            )}
            {lintErrors.length > 0 && (
              <Alert variant="warning" title="Lint issues — not saved" isInline style={{ marginBottom: 12 }}>
                <ul data-testid="pb-lint-errors">
                  {lintErrors.map((err) => (
                    <li key={`${err.line}-${err.message}`}>
                      Line {err.line}: {err.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            <div data-testid="blockly-block-count">{blockCount}</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: '1 1 45%', minWidth: 0 }}>
                <BlocklyWorkspace
                  toolbox={toolbox}
                  onChange={handleChange}
                  onWorkspaceReady={handleWorkspaceReady}
                />
              </div>
              <div style={{ flex: '1 1 30%', minWidth: 0 }}>
                <Title headingLevel="h3" size="sm" style={{ marginBottom: 8 }}>
                  Generated YAML
                </Title>
                <div data-testid="playbook-yaml-preview">
                  <CodeEditor
                    value={playbookYaml}
                    mode="yaml"
                    readOnly
                    rows={22}
                  />
                </div>
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <Title headingLevel="h3" size="sm" style={{ marginBottom: 8 }}>
                  Variables
                </Title>
                <VariablesPanel projectId={projectId} />
              </div>
            </div>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}

export default PlaybookBuilder;
