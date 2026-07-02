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

  it('falls back to a raw_task block for an unrecognized (non-builtin) module, losslessly', () => {
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

  it('imports a module with a non-default (optional) param by adding its row', () => {
    // debug.verbosity is optional (hidden by default) — importer must add it.
    const original = `
- name: p
  hosts: all
  tasks:
    - name: noisy
      debug:
        msg: hi
        verbosity: '2'
`;
    importPlaybookYaml(original, workspace);
    const regenerated = workspaceToPlaybook(workspace);
    expect(yaml.load(regenerated)).toEqual(yaml.load(original));
  });

  it('imports a module written in inline key=value shorthand as a typed block', () => {
    // Ansible's inline form, incl. FQCN — must NOT become a raw_task.
    const original = `
- name: p
  hosts: all
  tasks:
    - name: mkdir
      ansible.builtin.file: path=/tmp/x state=directory mode=0755
`;
    importPlaybookYaml(original, workspace);
    const types = workspace.getAllBlocks(false).map((b) => b.type);
    expect(types).toContain('module_file');
    expect(types).not.toContain('raw_task');

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].tasks[0].file).toEqual({ path: '/tmp/x', state: 'directory', mode: '0755' });
  });

  it('imports ansible.builtin.<name> with MULTIPLE task-level modifiers as a typed block (reported bug)', () => {
    // Previously: "find the first key that isn't name/when/tags/notify"
    // picked whichever modifier came first in the YAML (e.g. "loop") as if
    // IT were the module, corrupting the task and/or falling back to
    // raw_task even for a plain ansible.builtin module. Fixed by requiring
    // exactly one non-envelope key.
    const original = `
- name: p
  hosts: all
  tasks:
    - name: mkdir several
      ansible.builtin.file:
        path: "{{ item }}"
        state: directory
      loop:
        - /tmp/a
        - /tmp/b
      register: mkdir_result
      become: true
      ignore_errors: true
      delegate_to: localhost
`;
    importPlaybookYaml(original, workspace);
    const types = workspace.getAllBlocks(false).map((b) => b.type);
    expect(types).toContain('module_file');
    expect(types).not.toContain('raw_task');

    const regenerated = workspaceToPlaybook(workspace);
    const expected = yaml.load(original);
    // The generator always emits the module's short name (matches every
    // other test in this suite) — normalize the FQCN key for comparison.
    expected[0].tasks[0].file = expected[0].tasks[0]['ansible.builtin.file'];
    delete expected[0].tasks[0]['ansible.builtin.file'];
    expect(yaml.load(regenerated)).toEqual(expected);
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
