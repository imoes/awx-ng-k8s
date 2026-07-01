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

  it('serializes a play + task(debug, msg=hello) to the expected playbook YAML', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('site up', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const task = workspace.newBlock('task');
    task.setFieldValue('say hello', 'NAME');

    const debugModule = workspace.newBlock('module_debug');
    debugModule.setFieldValue('hello', 'msg');

    task.getInput('MODULE').connection.connect(debugModule.outputConnection);
    play.getInput('TASKS').connection.connect(task.previousConnection);

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
    const task = workspace.newBlock('task');
    task.setFieldValue('install', 'NAME');
    const aptModule = workspace.newBlock('module_apt');
    aptModule.setFieldValue('nginx', 'name');
    task.getInput('MODULE').connection.connect(aptModule.outputConnection);

    const parsed = yaml.load(serializeWorkspace(workspace, 'role'));
    expect(parsed).toEqual([{ name: 'install', apt: { name: 'nginx' } }]);
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
