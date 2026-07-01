/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder screen.
import React, { useMemo, useState } from 'react';
import { PageSection, Card, CardBody, Title } from '@patternfly/react-core';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import CodeEditor from 'components/CodeEditor';
import BlocklyWorkspace from './BlocklyWorkspace';
import { registerBlocks } from './blocks';
import { buildToolbox } from './toolbox';
import { workspaceToPlaybook } from './ansibleGenerator';

function PlaybookBuilder() {
  const [blockCount, setBlockCount] = useState(0);
  const [playbookYaml, setPlaybookYaml] = useState('---\n');
  // Block definitions must be registered before Blockly.inject runs; do it
  // once per mount, not on every render.
  const toolbox = useMemo(() => {
    registerBlocks();
    return buildToolbox();
  }, []);

  const handleChange = (workspace) => {
    setBlockCount(workspace.getAllBlocks(false).length);
    setPlaybookYaml(workspaceToPlaybook(workspace));
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
