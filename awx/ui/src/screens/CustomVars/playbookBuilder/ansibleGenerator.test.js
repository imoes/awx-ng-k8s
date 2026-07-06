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
    // WHEN is a value input (a condition-block tree), not a plain text field
    // — build ansible_os_family == 'Debian' out of cond_var/cond_literal/
    // cond_compare (see blocks.js / conditionParser.js).
    const whenLeft = workspace.newBlock('cond_var');
    whenLeft.setFieldValue('ansible_os_family', 'NAME');
    const whenRight = workspace.newBlock('cond_literal');
    whenRight.setFieldValue('Debian', 'VALUE');
    const whenCompare = workspace.newBlock('cond_compare');
    whenCompare.setFieldValue('==', 'OP');
    whenCompare.getInput('LEFT').connection.connect(whenLeft.outputConnection);
    whenCompare.getInput('RIGHT').connection.connect(whenRight.outputConnection);
    // Each task setting is now its own standalone block chained onto the
    // module's SETTINGS statement input — addEnvelopeField() creates it and
    // returns it so its (single) 'VALUE' field/input can be set.
    const whenSetting = debugModule.addEnvelopeField('WHEN');
    whenSetting.getInput('VALUE').connection.connect(whenCompare.outputConnection);
    debugModule.addEnvelopeField('REGISTER').setFieldValue('result', 'VALUE');
    debugModule.addEnvelopeField('BECOME').setFieldValue('TRUE', 'VALUE');
    debugModule.addEnvelopeField('LOOP').setFieldValue('[1, 2, 3]', 'VALUE');

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

  it('emits a play-level vars: mapping from chained define_var blocks, type-coerced', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('with vars', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const v1 = workspace.newBlock('define_var');
    v1.setFieldValue('app_name', 'NAME');
    v1.setFieldValue('myapp', 'VALUE'); // plain string
    const v2 = workspace.newBlock('define_var');
    v2.setFieldValue('port', 'NAME');
    v2.setFieldValue('8080', 'VALUE'); // coerced to a number
    const v3 = workspace.newBlock('define_var');
    v3.setFieldValue('packages', 'NAME');
    v3.setFieldValue('- nginx\n- curl', 'VALUE'); // coerced to a list

    play.getInput('VARS').connection.connect(v1.previousConnection);
    v1.nextConnection.connect(v2.previousConnection);
    v2.nextConnection.connect(v3.previousConnection);

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].vars).toEqual({
      app_name: 'myapp',
      port: 8080,
      packages: ['nginx', 'curl'],
    });
  });

  it('emits a dict-valued variable from a dict block (scalar, number, variable, nested dict)', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('with dict', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const v = workspace.newBlock('define_var');
    v.setFieldValue('db_config', 'NAME');

    const dict = workspace.newBlock('dict');
    // host: {{ db_host }}  (a variable → templated in a value context)
    const eHost = workspace.newBlock('dict_entry');
    eHost.setFieldValue('host', 'KEY');
    const hostVar = workspace.newBlock('cond_var');
    hostVar.setFieldValue('db_host', 'NAME');
    eHost.getInput('VALUE_BLOCK').connection.connect(hostVar.outputConnection);
    // port: 5432  (scalar text → number)
    const ePort = workspace.newBlock('dict_entry');
    ePort.setFieldValue('port', 'KEY');
    ePort.setFieldValue('5432', 'VALUE');
    // options: { ssl: true }  (nested dict)
    const eOpts = workspace.newBlock('dict_entry');
    eOpts.setFieldValue('options', 'KEY');
    const nested = workspace.newBlock('dict');
    const eSsl = workspace.newBlock('dict_entry');
    eSsl.setFieldValue('ssl', 'KEY');
    eSsl.setFieldValue('true', 'VALUE');
    nested.getInput('ENTRIES').connection.connect(eSsl.previousConnection);
    eOpts.getInput('VALUE_BLOCK').connection.connect(nested.outputConnection);

    dict.getInput('ENTRIES').connection.connect(eHost.previousConnection);
    eHost.nextConnection.connect(ePort.previousConnection);
    ePort.nextConnection.connect(eOpts.previousConnection);
    v.getInput('VALUE_BLOCK').connection.connect(dict.outputConnection);
    play.getInput('VARS').connection.connect(v.previousConnection);

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].vars.db_config).toEqual({
      host: '{{ db_host }}',
      port: 5432,
      options: { ssl: true },
    });
  });

  it('emits a dict-typed module param (set_stats.data) from a connected dict block', () => {
    const setStats = workspace.newBlock('module_set_stats');
    setStats.setFieldValue('record', 'NAME');
    const dict = workspace.newBlock('dict');
    const e1 = workspace.newBlock('dict_entry');
    e1.setFieldValue('processed', 'KEY');
    e1.setFieldValue('42', 'VALUE');
    dict.getInput('ENTRIES').connection.connect(e1.previousConnection);
    setStats.getInput('BLOCK_data').connection.connect(dict.outputConnection);

    const parsed = yaml.load(serializeWorkspace(workspace, 'role'));
    expect(parsed[0].set_stats.data).toEqual({ processed: 42 });
  });

  it('emits a list-valued variable from a list block (scalar, variable, nested dict)', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('with list', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const v = workspace.newBlock('define_var');
    v.setFieldValue('servers', 'NAME');

    const list = workspace.newBlock('list');
    // item 0: 'nginx' (plain scalar text)
    const item1 = workspace.newBlock('list_item');
    item1.setFieldValue('nginx', 'VALUE');
    // item 1: {{ primary_host }} (a variable → templated in a value context)
    const item2 = workspace.newBlock('list_item');
    const hostVar = workspace.newBlock('cond_var');
    hostVar.setFieldValue('primary_host', 'NAME');
    item2.getInput('VALUE_BLOCK').connection.connect(hostVar.outputConnection);
    // item 2: { role: web } (nested dict)
    const item3 = workspace.newBlock('list_item');
    const nested = workspace.newBlock('dict');
    const eRole = workspace.newBlock('dict_entry');
    eRole.setFieldValue('role', 'KEY');
    eRole.setFieldValue('web', 'VALUE');
    nested.getInput('ENTRIES').connection.connect(eRole.previousConnection);
    item3.getInput('VALUE_BLOCK').connection.connect(nested.outputConnection);

    list.getInput('ITEMS').connection.connect(item1.previousConnection);
    item1.nextConnection.connect(item2.previousConnection);
    item2.nextConnection.connect(item3.previousConnection);
    v.getInput('VALUE_BLOCK').connection.connect(list.outputConnection);
    play.getInput('VARS').connection.connect(v.previousConnection);

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].vars.servers).toEqual([
      'nginx',
      '{{ primary_host }}',
      { role: 'web' },
    ]);
  });

  it('emits a list-typed module param (apt.name) from a connected list block', () => {
    const apt = workspace.newBlock('module_apt');
    apt.setFieldValue('install packages', 'NAME');
    const list = workspace.newBlock('list');
    const item1 = workspace.newBlock('list_item');
    item1.setFieldValue('nginx', 'VALUE');
    const item2 = workspace.newBlock('list_item');
    item2.setFieldValue('curl', 'VALUE');
    list.getInput('ITEMS').connection.connect(item1.previousConnection);
    item1.nextConnection.connect(item2.previousConnection);
    apt.getInput('BLOCK_name').connection.connect(list.outputConnection);

    const parsed = yaml.load(serializeWorkspace(workspace, 'role'));
    expect(parsed[0].apt.name).toEqual(['nginx', 'curl']);
  });

  it('serializeWorkspace re-emits a raw_section block verbatim for vars/tasks/role modes (lossless fallback)', () => {
    const original = 'docker_daemon_gelf:\n  tag: !unsafe "{{.Name}}"\n';
    const raw = workspace.newBlock('raw_section');
    raw.setFieldValue(original, 'RAW_YAML');
    expect(serializeWorkspace(workspace, 'vars')).toBe(original);
    expect(serializeWorkspace(workspace, 'tasks')).toBe(original);
    expect(serializeWorkspace(workspace, 'role')).toBe(original);
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

  it('serializeWorkspace("vars") emits a bare vars: mapping (role defaults/main.yml shape)', () => {
    const v1 = workspace.newBlock('define_var');
    v1.setFieldValue('nginx_port', 'NAME');
    v1.setFieldValue('8080', 'VALUE');
    const v2 = workspace.newBlock('define_var');
    v2.setFieldValue('nginx_worker_processes', 'NAME');
    v2.setFieldValue('auto', 'VALUE');
    v1.nextConnection.connect(v2.previousConnection);

    const parsed = yaml.load(serializeWorkspace(workspace, 'vars'));
    expect(parsed).toEqual({ nginx_port: 8080, nginx_worker_processes: 'auto' });
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

  it('emits a play-level handlers: list from the HANDLERS chain (same shape as tasks)', () => {
    const play = workspace.newBlock('play');
    play.setFieldValue('with handlers', 'NAME');
    play.setFieldValue('all', 'HOSTS');

    const task = workspace.newBlock('module_service');
    task.setFieldValue('configure nginx', 'NAME');
    task.setFieldValue('nginx', 'name');
    task.setFieldValue('started', 'state');
    task.addEnvelopeField('NOTIFY').setFieldValue('restart nginx', 'VALUE');

    const handler = workspace.newBlock('module_service');
    handler.setFieldValue('restart nginx', 'NAME');
    handler.setFieldValue('nginx', 'name');
    handler.setFieldValue('restarted', 'state');

    play.getInput('TASKS').connection.connect(task.previousConnection);
    play.getInput('HANDLERS').connection.connect(handler.previousConnection);

    const parsed = yaml.load(workspaceToPlaybook(workspace));
    expect(parsed[0].tasks[0]).toEqual({
      name: 'configure nginx',
      service: { name: 'nginx', state: 'started' },
      notify: ['restart nginx'], // notify is always emitted as a list (see TAGS/NOTIFY handling)
    });
    expect(parsed[0].handlers).toEqual([
      { name: 'restart nginx', service: { name: 'nginx', state: 'restarted' } },
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
