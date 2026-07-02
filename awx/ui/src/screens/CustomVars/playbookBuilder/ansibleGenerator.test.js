import * as Blockly from 'blockly';
import yaml from 'js-yaml';
import { registerBlocks } from './blocks';
import { workspaceToPlaybook, serializeWorkspace } from './ansibleGenerator';

describe('ansibleGenerator', () => {
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

  it('coerces a list-typed param (apt.name) from comma text into a real YAML array', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('install packages', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const apt = workspace.newBlock('module_apt');
    apt.setFieldValue('install nginx and curl', 'NAME');
    apt.setFieldValue('nginx, curl', 'name'); // quick comma shorthand
    apt.setFieldValue('present', 'state');

    play.getInput('TASKS').connection.connect(apt.previousConnection);

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].tasks[0].apt).toEqual({ name: ['nginx', 'curl'], state: 'present' });
  });

  it('coerces a list-typed param given as full YAML list syntax', () => {
    const apt = workspace.newBlock('module_apt');
    apt.setFieldValue('- nginx\n- curl', 'name');
    apt.setFieldValue('present', 'state');
    const parsed = yaml.load(serializeWorkspace(workspace, 'role'));
    expect(parsed[0].apt.name).toEqual(['nginx', 'curl']);
  });

  it('coerces an int-typed param from field text into a real YAML number', () => {
    const apt = workspace.newBlock('module_apt');
    apt.setFieldValue('nginx', 'name');
    apt.addOptionalParam('cache_valid_time');
    apt.setFieldValue('3600', 'cache_valid_time');
    const parsed = yaml.load(serializeWorkspace(workspace, 'role'));
    expect(parsed[0].apt.cache_valid_time).toBe(3600);
    expect(typeof parsed[0].apt.cache_valid_time).toBe('number');
  });

  it('serializes a play + module_debug(name, msg) to the expected playbook YAML', () => {
    // No separate "task" wrapper — the module block plugs directly into
    // the play's TASKS stack (consolidated per user feedback).
    const play = workspace.newBlock('play');
    play.setFieldValue('site up', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const debugModule = workspace.newBlock('module_debug');
    debugModule.setFieldValue('say hello', 'NAME');
    debugModule.setFieldValue('hello', 'msg');

    play.getInput('TASKS').connection.connect(debugModule.previousConnection);

    const outputYaml = workspaceToPlaybook(workspace);
    const parsed = yaml.load(outputYaml);

    expect(parsed).toEqual([
      {
        name: 'site up',
        hosts: 'all',
        tasks: [
          {
            name: 'say hello',
            debug: { msg: 'hello' },
          },
        ],
      },
    ]);
  });

  it('emits task-level modifiers (when/tags/register/loop/become) alongside the module', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('mods', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const debugModule = workspace.newBlock('module_debug');
    debugModule.setFieldValue('checking', 'NAME');
    debugModule.setFieldValue('hi', 'msg');
    debugModule.addEnvelopeField('WHEN');
    debugModule.setFieldValue("ansible_os_family == 'Debian'", 'WHEN');
    debugModule.addEnvelopeField('REGISTER');
    debugModule.setFieldValue('result', 'REGISTER');
    debugModule.addEnvelopeField('BECOME');
    debugModule.setFieldValue('TRUE', 'BECOME');
    debugModule.addEnvelopeField('LOOP');
    debugModule.setFieldValue('[1, 2, 3]', 'LOOP');

    play.getInput('TASKS').connection.connect(debugModule.previousConnection);

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].tasks[0]).toEqual({
      name: 'checking',
      debug: { msg: 'hi' },
      when: "ansible_os_family == 'Debian'",
      register: 'result',
      become: true,
      loop: [1, 2, 3],
    });
  });

  it('returns an empty-document YAML for an empty workspace', () => {
    const outputYaml = workspaceToPlaybook(workspace);
    expect(outputYaml.trim()).toBe('---');
  });

  it('ignores a play EXTRA field that is not a YAML mapping (no char-spread bug)', () => {
    // Reproduces the reported bug: a bare string in EXTRA (e.g. a variable
    // name dropped onto it) must NOT be spread into {0:'c',1:'m',...} keys.
    const play = workspace.newBlock('play');
    play.setFieldValue('safe', 'NAME');
    play.setFieldValue('all', 'HOSTS');
    play.setFieldValue('cmk_hostname', 'EXTRA');

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed).toEqual([{ name: 'safe', hosts: 'all', tasks: [] }]);
    expect(Object.keys(parsed[0])).not.toContain('0');
  });

  it('serializeWorkspace("role") emits a bare task list (no play wrapper)', () => {
    const aptModule = workspace.newBlock('module_apt');
    aptModule.setFieldValue('install', 'NAME');
    aptModule.setFieldValue('nginx', 'name');

    const parsed = yaml.load(serializeWorkspace(workspace, 'role'));
    // apt.name is list-typed, so even a single package name is coerced to a
    // one-element array — the technically correct Ansible representation.
    expect(parsed).toEqual([{ name: 'install', apt: { name: ['nginx'] } }]);
  });

  it('emits a correct roles: list from two role_use blocks (one with vars)', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('provision', 'NAME');
    play.setFieldValue('webservers', 'HOSTS');

    const role1 = workspace.newBlock('role_use');
    role1.setFieldValue('img_common', 'ROLE_NAME');

    const role2 = workspace.newBlock('role_use');
    role2.setFieldValue('img_docker', 'ROLE_NAME');
    role2.setFieldValue('docker_version: "24.0"', 'VARS');

    play.getInput('ROLES').connection.connect(role1.previousConnection);
    role1.nextConnection.connect(role2.previousConnection);

    const outputYaml = workspaceToPlaybook(workspace);
    const parsed = yaml.load(outputYaml);

    expect(parsed[0].roles).toEqual([
      'img_common',
      { role: 'img_docker', docker_version: '24.0' },
    ]);
  });

  it('serializes a raw_task fallback block verbatim (round-trip safety)', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('web', 'NAME');
    play.setFieldValue('webservers', 'HOSTS');

    const rawTask = workspace.newBlock('raw_task');
    rawTask.setFieldValue('community.general.ufw: {rule: allow, port: "80"}', 'RAW_YAML');

    play.getInput('TASKS').connection.connect(rawTask.previousConnection);

    const outputYaml = workspaceToPlaybook(workspace);
    const parsed = yaml.load(outputYaml);

    expect(parsed[0].tasks[0]).toEqual({
      'community.general.ufw': { rule: 'allow', port: '80' },
    });
  });
});
