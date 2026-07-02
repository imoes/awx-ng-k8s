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
    // verbosity is int-typed — the quoted '2' round-trips as the number 2,
    // which is the ansible-doc-correct representation (and what Ansible
    // would coerce it to at runtime regardless).
    const expected = yaml.load(original);
    expected[0].tasks[0].debug.verbosity = 2;
    expect(yaml.load(regenerated)).toEqual(expected);
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

  it('imports ansible.builtin.apt with a LIST-valued name (multi-package install) as a typed block', () => {
    // Real-world usage: apt/yum/dnf/pip/package's `name` param accepts a list
    // of packages. Previously ANY non-scalar arg value forced raw_task,
    // even for a plain ansible.builtin module — the residual cause behind
    // "ansible.builtin modules still show up as raw task".
    const original = `
- hosts: all
  tasks:
    - name: install packages
      ansible.builtin.apt:
        name:
          - nginx
          - curl
        state: present
`;
    importPlaybookYaml(original, workspace);
    const types = workspace.getAllBlocks(false).map((b) => b.type);
    expect(types).toContain('module_apt');
    expect(types).not.toContain('raw_task');

    const regenerated = yaml.load(workspaceToPlaybook(workspace));
    expect(regenerated[0].tasks[0].apt).toEqual({ name: ['nginx', 'curl'], state: 'present' });
  });

  it('imports a required DICT-typed param (set_stats.data) as a typed block', () => {
    const original = `
- hosts: all
  tasks:
    - name: record stats
      set_stats:
        data:
          foo: bar
          count: 3
`;
    importPlaybookYaml(original, workspace);
    const types = workspace.getAllBlocks(false).map((b) => b.type);
    expect(types).toContain('module_set_stats');
    expect(types).not.toContain('raw_task');
    const regenerated = yaml.load(workspaceToPlaybook(workspace));
    expect(regenerated[0].tasks[0].set_stats.data).toEqual({ foo: 'bar', count: 3 });
  });

  it('imports the legacy with_items keyword as the modern loop equivalent', () => {
    const original = `
- hosts: all
  tasks:
    - name: create dirs
      ansible.builtin.file:
        path: "{{ item }}"
        state: directory
      with_items:
        - /tmp/a
        - /tmp/b
`;
    importPlaybookYaml(original, workspace);
    const types = workspace.getAllBlocks(false).map((b) => b.type);
    expect(types).toContain('module_file');
    expect(types).not.toContain('raw_task');
    const regenerated = yaml.load(workspaceToPlaybook(workspace));
    // Normalized to the modern `loop:` keyword on regeneration.
    expect(regenerated[0].tasks[0].loop).toEqual(['/tmp/a', '/tmp/b']);
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
    // apt.name is list-typed — a single package name round-trips as a
    // one-element array (service.name is str-typed and stays a plain string).
    const expected = yaml.load(original);
    expected[0].apt.name = ['nginx'];
    expect(yaml.load(regenerated)).toEqual(expected);
  });
});
