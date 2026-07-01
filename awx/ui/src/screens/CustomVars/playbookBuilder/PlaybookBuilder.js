/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder — Section A scaffold.
// Uses a single built-in Blockly block ("text") to verify the wrapper end-to-end
// before any Ansible-specific blocks are introduced (Section C).
import React, { useState } from 'react';
import { PageSection, Card, CardBody, Title } from '@patternfly/react-core';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import BlocklyWorkspace from './BlocklyWorkspace';

const TEST_TOOLBOX = {
  kind: 'flyoutToolbox',
  contents: [{ kind: 'block', type: 'text' }],
};

function PlaybookBuilder() {
  const [blockCount, setBlockCount] = useState(0);

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
              Scaffold test — drag the &quot;text&quot; block onto the canvas
            </Title>
            <div data-testid="blockly-block-count">{blockCount}</div>
            <BlocklyWorkspace toolbox={TEST_TOOLBOX} onChange={handleChange} />
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}

export default PlaybookBuilder;
