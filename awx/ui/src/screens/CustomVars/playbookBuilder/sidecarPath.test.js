import { sidecarPathFor } from './sidecarPath';

describe('sidecarPathFor', () => {
  it('replaces the extension with .blockly.json', () => {
    expect(sidecarPathFor('playbooks/site.yml')).toBe('playbooks/site.blockly.json');
    expect(sidecarPathFor('playbooks/blockly-test.yml')).toBe('playbooks/blockly-test.blockly.json');
    expect(sidecarPathFor('roles/foo/tasks/main.yaml')).toBe('roles/foo/tasks/main.blockly.json');
  });
});
