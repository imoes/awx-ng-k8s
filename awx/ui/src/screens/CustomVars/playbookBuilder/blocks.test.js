import * as Blockly from 'blockly';
import { registerBlocks, moduleBlockType, MODULE_NAMES } from './blocks';
import { buildToolbox } from './toolbox';

describe('playbook builder blocks', () => {
  beforeAll(() => {
    registerBlocks();
  });

  it('registers a block type for every catalog module without throwing', () => {
    expect(MODULE_NAMES.length).toBeGreaterThan(0);
    MODULE_NAMES.forEach((name) => {
      expect(Blockly.Blocks[moduleBlockType(name)]).toBeDefined();
    });
  });

  it('registers the static play/role/raw/define_var blocks', () => {
    expect(Blockly.Blocks.play).toBeDefined();
    expect(Blockly.Blocks.role_use).toBeDefined();
    expect(Blockly.Blocks.raw_task).toBeDefined();
    expect(Blockly.Blocks.define_var).toBeDefined();
  });

  it('registers raw_section (whole-file fallback for an unparseable role section)', () => {
    expect(Blockly.Blocks.raw_section).toBeDefined();
    const workspace = new Blockly.Workspace();
    const block = workspace.newBlock('raw_section');
    expect(block.getField('RAW_YAML')).toBeDefined();
    // No previous/next/output connection — it floats alone as the section's
    // sole content rather than chaining with other blocks.
    expect(block.previousConnection).toBeNull();
    expect(block.nextConnection).toBeNull();
    expect(block.outputConnection).toBeNull();
    workspace.dispose();
  });

  it('play has a VARS statement chain for define_var blocks, alongside ROLES/TASKS', () => {
    const workspace = new Blockly.Workspace();
    const play = workspace.newBlock('play');
    expect(play.getInput('VARS').connection.getCheck()).toContain('Var');
    const v1 = workspace.newBlock('define_var');
    v1.setFieldValue('enabled', 'NAME');
    v1.setFieldValue('true', 'VALUE');
    expect(v1.previousConnection.getCheck()).toContain('Var');
    play.getInput('VARS').connection.connect(v1.previousConnection);
    expect(play.getInputTargetBlock('VARS')).toBe(v1);
    workspace.dispose();
  });

  it('registers dict/dict_entry value blocks', () => {
    expect(Blockly.Blocks.dict).toBeDefined();
    expect(Blockly.Blocks.dict_entry).toBeDefined();
  });

  it('a dict is a value (not a condition): fits a variable/dict slot but NOT a when: slot', () => {
    const workspace = new Blockly.Workspace();
    const dict = workspace.newBlock('dict');
    expect(dict.outputConnection.getCheck()).toContain('Value');

    // Fits define_var's optional value-block input …
    const v = workspace.newBlock('define_var');
    expect(v.getInput('VALUE_BLOCK').connection.getCheck()).toContain('Value');
    v.getInput('VALUE_BLOCK').connection.connect(dict.outputConnection);
    expect(v.getInputTargetBlock('VALUE_BLOCK')).toBe(dict);

    // … but a dict must NOT be accepted as a when: condition (setting_when's
    // value input only takes 'Cond'). The connection checker is exactly what
    // the drag UI consults, so asserting it rejects the pair is the real test.
    const whenSetting = workspace.newBlock('setting_when');
    const dict2 = workspace.newBlock('dict');
    const checker = workspace.connectionChecker;
    expect(
      checker.canConnect(whenSetting.getInput('VALUE').connection, dict2.outputConnection, false)
    ).toBe(false);
    workspace.dispose();
  });

  it('dict_entry takes a scalar text field OR a value block (variable / nested dict)', () => {
    const workspace = new Blockly.Workspace();
    const entry = workspace.newBlock('dict_entry');
    expect(entry.getField('KEY')).toBeDefined();
    expect(entry.getField('VALUE')).toBeDefined();
    // A bare variable reference (cond_var, wildcard output) plugs into the
    // entry's value-block input.
    const v = workspace.newBlock('cond_var');
    entry.getInput('VALUE_BLOCK').connection.connect(v.outputConnection);
    expect(entry.getInputTargetBlock('VALUE_BLOCK')).toBe(v);
    // Entries chain vertically inside a dict.
    const entry2 = workspace.newBlock('dict_entry');
    entry.nextConnection.connect(entry2.previousConnection);
    expect(entry.getNextBlock()).toBe(entry2);
    workspace.dispose();
  });

  it('dict-typed module params (e.g. set_stats.data) get a BLOCK_<name> value input for a dict block', () => {
    const workspace = new Blockly.Workspace();
    const setStats = workspace.newBlock(moduleBlockType('set_stats'));
    // data is required (shown by default) and dict-typed → text field + block input.
    expect(setStats.getField('data')).toBeDefined();
    const blockInput = setStats.getInput('BLOCK_data');
    expect(blockInput).not.toBeNull();
    expect(blockInput.connection.getCheck()).toContain('Value');
    const dict = workspace.newBlock('dict');
    blockInput.connection.connect(dict.outputConnection);
    expect(setStats.getInputTargetBlock('BLOCK_data')).toBe(dict);
    workspace.dispose();
  });

  it('registers list/list_item value blocks', () => {
    expect(Blockly.Blocks.list).toBeDefined();
    expect(Blockly.Blocks.list_item).toBeDefined();
  });

  it('a list is a value (not a condition): fits a variable/list slot but NOT a when: slot', () => {
    const workspace = new Blockly.Workspace();
    const list = workspace.newBlock('list');
    expect(list.outputConnection.getCheck()).toContain('Value');

    // Fits define_var's optional value-block input …
    const v = workspace.newBlock('define_var');
    v.getInput('VALUE_BLOCK').connection.connect(list.outputConnection);
    expect(v.getInputTargetBlock('VALUE_BLOCK')).toBe(list);

    // … but a list must NOT be accepted as a when: condition, same rule as dict.
    const whenSetting = workspace.newBlock('setting_when');
    const list2 = workspace.newBlock('list');
    const checker = workspace.connectionChecker;
    expect(
      checker.canConnect(whenSetting.getInput('VALUE').connection, list2.outputConnection, false)
    ).toBe(false);
    workspace.dispose();
  });

  it('list_item takes a scalar text field OR a value block (variable / nested dict/list)', () => {
    const workspace = new Blockly.Workspace();
    const item = workspace.newBlock('list_item');
    expect(item.getField('VALUE')).toBeDefined();
    // A bare variable reference plugs into the item's value-block input.
    const v = workspace.newBlock('cond_var');
    item.getInput('VALUE_BLOCK').connection.connect(v.outputConnection);
    expect(item.getInputTargetBlock('VALUE_BLOCK')).toBe(v);
    // A nested dict also fits (lists and dicts can nest into each other).
    const item2 = workspace.newBlock('list_item');
    const nestedDict = workspace.newBlock('dict');
    item2.getInput('VALUE_BLOCK').connection.connect(nestedDict.outputConnection);
    expect(item2.getInputTargetBlock('VALUE_BLOCK')).toBe(nestedDict);
    // Items chain vertically inside a list.
    item.nextConnection.connect(item2.previousConnection);
    expect(item.getNextBlock()).toBe(item2);
    workspace.dispose();
  });

  it('list-typed module params (e.g. apt.name) get a BLOCK_<name> value input for a list block', () => {
    const workspace = new Blockly.Workspace();
    const apt = workspace.newBlock(moduleBlockType('apt'));
    // name is primary-shown and list-typed → text field + block input.
    expect(apt.getField('name')).toBeDefined();
    const blockInput = apt.getInput('BLOCK_name');
    expect(blockInput).not.toBeNull();
    expect(blockInput.connection.getCheck()).toContain('Value');
    const list = workspace.newBlock('list');
    blockInput.connection.connect(list.outputConnection);
    expect(apt.getInputTargetBlock('BLOCK_name')).toBe(list);
    workspace.dispose();
  });

  it('can instantiate a module block (e.g. debug) on a headless workspace', () => {
    const workspace = new Blockly.Workspace();
    const block = workspace.newBlock(moduleBlockType('debug'));
    block.initSvg = undefined; // headless — no rendering
    expect(block.type).toBe('module_debug');
    expect(block.ansibleModuleFqcn).toBe('ansible.builtin.debug');
    workspace.dispose();
  });

  it('module blocks plug directly into a task stack — no separate task wrapper', () => {
    const workspace = new Blockly.Workspace();
    const debug = workspace.newBlock(moduleBlockType('debug'));
    expect(debug.previousConnection).toBeDefined();
    expect(debug.previousConnection.getCheck()).toContain('Task');
    expect(debug.nextConnection.getCheck()).toContain('Task');
    expect(debug.getField('NAME')).toBeDefined(); // task name lives on the module block itself
    workspace.dispose();
  });

  it('offers task-level modifiers (when/tags/register/…) as standalone blocks chained via "add task setting…"', () => {
    // Each setting is its OWN single-row block (not a field on the module
    // block) so Blockly can safely render it "inline" (recessed condition
    // socket for WHEN) without disturbing the module's one-row-per-param
    // layout — see blocks.js defineTaskSettingBlocks().
    const workspace = new Blockly.Workspace();
    const debug = workspace.newBlock(moduleBlockType('debug'));
    expect(debug.getField('ADD_PARAM')).toBeDefined();
    expect(debug.getField('ADD_TASKOPT')).toBeDefined();
    expect(debug.getInput('SETTINGS').connection.targetBlock()).toBeNull();

    debug.addEnvelopeField('WHEN');
    debug.addEnvelopeField('REGISTER');

    const chain = [];
    let b = debug.getInput('SETTINGS').connection.targetBlock();
    while (b) { chain.push(b.settingKey_); b = b.getNextBlock(); }
    expect(chain).toEqual(['WHEN', 'REGISTER']);
    // addEnvelopeField is idempotent — calling again returns the same block.
    expect(debug.addEnvelopeField('WHEN').settingKey_).toBe('WHEN');
    expect(debug.saveExtraState()).toBeNull(); // no optional params added
    workspace.dispose();
  });

  it('shows only required+primary params by default (small blocks)', () => {
    const workspace = new Blockly.Workspace();
    // debug: 0 required, primary = [msg] → only msg shown by default
    const debug = workspace.newBlock(moduleBlockType('debug'));
    expect(debug.getField('msg')).toBeDefined();
    expect(debug.getField('verbosity')).toBeNull(); // optional, hidden by default
    // apt: primary = [name, state] → both shown, but not the ~20 others
    const apt = workspace.newBlock(moduleBlockType('apt'));
    expect(apt.getField('name')).toBeDefined();
    expect(apt.getField('state')).toBeDefined();
    expect(apt.getField('upgrade')).toBeNull();
    workspace.dispose();
  });

  it('disambiguates the task name from a module\'s own "name" param (23 modules have one)', () => {
    const workspace = new Blockly.Workspace();
    // apt, package, user, yum, dnf, group, etc. all have their own
    // required/optional "name" param — the task's own description field
    // must not also read "name:" or the block shows it twice with no way
    // to tell them apart (reported bug).
    const apt = workspace.newBlock(moduleBlockType('apt'));
    const taskNameField = apt.getField('NAME');
    const moduleNameField = apt.getField('name');
    expect(taskNameField).toBeDefined();
    expect(moduleNameField).toBeDefined();
    expect(taskNameField).not.toBe(moduleNameField);
    // Label text must differ so the UI doesn't show "name:" twice.
    const taskLabel = apt.inputList.find((i) => i.name === 'ROW_NAME').fieldRow[0].getText();
    expect(taskLabel.toLowerCase()).not.toBe('name:');
    workspace.dispose();
  });

  it('exposes ansible-doc param types (paramTypes_) for the generator/importer', () => {
    const workspace = new Blockly.Workspace();
    const apt = workspace.newBlock(moduleBlockType('apt'));
    expect(apt.paramTypes_.name).toBe('list');
    expect(apt.paramTypes_.state).toBe('str');
    const find = workspace.newBlock(moduleBlockType('find'));
    expect(find.paramTypes_.paths).toBe('list');
    workspace.dispose();
  });

  it('exposes ansible-doc param aliases (paramAliases_) so the importer recognizes either spelling', () => {
    const workspace = new Blockly.Workspace();
    // ansible.builtin.file's canonical param is "path"; "dest" and "name"
    // are documented aliases real playbooks commonly use instead.
    const file = workspace.newBlock(moduleBlockType('file'));
    expect(file.paramAliases_.dest).toBe('path');
    expect(file.paramAliases_.name).toBe('path');
    // apt's "name" has aliases "pkg"/"package"; systemd's "name" has "unit".
    const apt = workspace.newBlock(moduleBlockType('apt'));
    expect(apt.paramAliases_.pkg).toBe('name');
    const systemd = workspace.newBlock(moduleBlockType('systemd'));
    expect(systemd.paramAliases_.unit).toBe('name');
    workspace.dispose();
  });

  it('curates state choices for "package" (the only module ansible-doc leaves generic)', () => {
    const workspace = new Blockly.Workspace();
    const pkg = workspace.newBlock(moduleBlockType('package'));
    const stateField = pkg.getField('state');
    const options = stateField.getOptions().map((o) => o[1]);
    expect(options).toEqual(expect.arrayContaining(['present', 'absent', 'latest']));
    workspace.dispose();
  });

  it('addOptionalParam adds a hidden param and round-trips via save/loadExtraState', () => {
    const workspace = new Blockly.Workspace();
    const debug = workspace.newBlock(moduleBlockType('debug'));
    expect(debug.getField('verbosity')).toBeNull();
    debug.addOptionalParam('verbosity');
    expect(debug.getField('verbosity')).toBeDefined();
    expect(debug.saveExtraState()).toEqual({ optional: ['verbosity'] });

    // Re-create and restore
    const debug2 = workspace.newBlock(moduleBlockType('debug'));
    expect(debug2.getField('verbosity')).toBeNull();
    debug2.loadExtraState({ optional: ['verbosity'] });
    expect(debug2.getField('verbosity')).toBeDefined();
    expect(debug2.saveExtraState()).toEqual({ optional: ['verbosity'] });
    workspace.dispose();
  });

  it('saveExtraState returns null in the default state', () => {
    const workspace = new Blockly.Workspace();
    const debug = workspace.newBlock(moduleBlockType('debug'));
    expect(debug.saveExtraState()).toBeNull();
    workspace.dispose();
  });

  it('builds a toolbox with a global search category + static Modules/Roles categories (searchable by @blockly/toolbox-search)', () => {
    const toolbox = buildToolbox();
    expect(toolbox.contents[0]).toEqual({ kind: 'search', name: '🔍 Search', contents: [] });
    const modulesCategory = toolbox.contents.find((c) => c.name === 'Modules');
    expect(modulesCategory.contents.length).toBe(MODULE_NAMES.length);
    expect(modulesCategory.contents.every((b) => b.kind === 'block')).toBe(true);
    // No roles passed → still offers a blank role_use block.
    const rolesCategory = toolbox.contents.find((c) => c.name === 'Roles');
    expect(rolesCategory.contents).toEqual([{ kind: 'block', type: 'role_use' }]);
  });

  it('buildToolbox(roleNames) fills the Roles category with pre-filled role_use blocks', () => {
    const toolbox = buildToolbox(['img_docker', 'img_common']);
    const rolesCategory = toolbox.contents.find((c) => c.name === 'Roles');
    // sorted alphabetically
    expect(rolesCategory.contents.map((b) => b.fields.ROLE_NAME)).toEqual(['img_common', 'img_docker']);
  });
});
