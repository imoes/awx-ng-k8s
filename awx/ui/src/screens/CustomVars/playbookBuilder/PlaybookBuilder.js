/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder screen.
import React, { useMemo, useState } from 'react';
import { PageSection, Card, CardBody, Title } from '@patternfly/react-core';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import BlocklyWorkspace from './BlocklyWorkspace';
import { registerBlocks } from './blocks';
import { buildToolbox } from './toolbox';

function PlaybookBuilder() {
  const [blockCount, setBlockCount] = useState(0);
  // Block definitions must be registered before Blockly.inject runs; do it
  // once per mount, not on every render.
  const toolbox = useMemo(() => {
    registerBlocks();
    return buildToolbox();
  }, []);

  const handleChange = (workspace) => {
    setBlockCount(workspace.getAllBlocks(false).length);
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
            <BlocklyWorkspace toolbox={toolbox} onChange={handleChange} />
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}

export default PlaybookBuilder;
