import * as Blockly from 'blockly';
import yaml from 'js-yaml';
import { registerBlocks } from './blocks';
import { importPlaybookYaml, importTasksYaml } from './playbookImporter';
import { workspaceToPlaybook, serializeWorkspace } from './ansibleGenerator';

describe('playbookImporter', () => {
  let workspace;

  beforeAll(() => {
    registerBlocks();
  });

  beforeEach(() => {
    workspace = new Blockly.Workspace();
  });

  afterEach(() => {
    workspace.dispose();
  });

  it('round-trips a play with a recognized module task with no data loss', () => {
    const original = `
- name: site up
  hosts: all
  become: true
  tasks:
    - name: say hello
      debug:
        msg: hello
`;
    const count = importPlaybookYaml(original, workspace);
    expect(count).toBe(1);

    const regenerated = workspaceToPlaybook(workspace);
    expect(yaml.load(regenerated)).toEqual(yaml.load(original));
  });

  it("round-trips ansible-manager's real playbooks/docker.yml (roles + environment + become)", () => {
    const original = `
- name: Setup
  become: true
  hosts: all
  roles:
    - img_common
    - img_system
    - img_docker
    - img_freeipa_client
  environment:
    https_proxy: http://proxy.ippen.media:80
    http_proxy: http://proxy.ippen.media:80
  tasks: []
`;
    importPlaybookYaml(original, workspace);
    const regenerated = workspaceToPlaybook(workspace);
    expect(yaml.load(regenerated)).toEqual(yaml.load(original));
  });

  it('falls back to a raw_yaml block for an unrecognized (non-builtin) module, losslessly', () => {
    const original = `
- name: firewall play
  hosts: webservers
  tasks:
    - name: allow http
      community.general.ufw:
        rule: allow
        port: '80'
`;
    importPlaybookYaml(original, workspace);

    const blocks = workspace.getAllBlocks(false);
    const rawTask = blocks.find((b) => b.type === 'raw_task');
    expect(rawTask).toBeDefined();

    const regenerated = workspaceToPlaybook(workspace);
    expect(yaml.load(regenerated)).toEqual(yaml.load(original));
  });

  it('falls back to a raw_task block for constructs without a module key (e.g. block/rescue)', () => {
    const original = `
- name: error handling play
  hosts: all
  tasks:
    - name: try something
      block:
        - debug:
            msg: inner
      rescue:
        - debug:
            msg: recovered
`;
    importPlaybookYaml(original, workspace);
    const regenerated = workspaceToPlaybook(workspace);
    expect(yaml.load(regenerated)).toEqual(yaml.load(original));
  });

  it('throws a clear error for non-playbook YAML (not a top-level list)', () => {
    expect(() => importPlaybookYaml('foo: bar', workspace)).toThrow(/list of plays/);
  });

  it('round-trips a role tasks/main.yml (bare task list) with no data loss', () => {
    const original = `
- name: install nginx
  apt:
    name: nginx
    state: present
- name: start nginx
  service:
    name: nginx
    state: started
`;
    const count = importTasksYaml(original, workspace);
    expect(count).toBe(2);
    const regenerated = serializeWorkspace(workspace, 'role');
    expect(yaml.load(regenerated)).toEqual(yaml.load(original));
  });
});
