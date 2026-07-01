/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder screen.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { readProjects, saveProjectFile, lintProjectFile } from '../api';

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

  // Block definitions must be registered before Blockly.inject runs; do it
  // once per mount, not on every render.
  const toolbox = useMemo(() => {
    registerBlocks();
    return buildToolbox();
  }, []);

  const { request: loadProjects } = useRequest(
    useCallback(async () => {
      const { data } = await readProjects({ page_size: 200, order_by: 'name' });
      setProjects(data.results || []);
      if (data.results?.length) setProjectId(String(data.results[0].id));
    }, [])
  );
  useEffect(() => { loadProjects(); }, [loadProjects]);

  const handleChange = (workspace) => {
    setBlockCount(workspace.getAllBlocks(false).length);
    setPlaybookYaml(workspaceToPlaybook(workspace));
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
      setSaved(true);
    } catch (e) {
      setSaveError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
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
            </div>

            {saveError && <Alert variant="danger" title={saveError} isInline style={{ marginBottom: 12 }} />}
            {saved && <Alert variant="success" title={`Saved to ${targetPath}`} isInline style={{ marginBottom: 12 }} />}
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
              <div style={{ flex: '1 1 60%', minWidth: 0 }}>
                <BlocklyWorkspace toolbox={toolbox} onChange={handleChange} />
              </div>
              <div style={{ flex: '1 1 40%', minWidth: 0 }}>
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
            </div>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}

export default PlaybookBuilder;
