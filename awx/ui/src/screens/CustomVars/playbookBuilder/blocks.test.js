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

  it('registers the static play/task/raw blocks', () => {
    expect(Blockly.Blocks.play).toBeDefined();
    expect(Blockly.Blocks.task).toBeDefined();
    expect(Blockly.Blocks.raw_task).toBeDefined();
    expect(Blockly.Blocks.raw_yaml).toBeDefined();
  });

  it('can instantiate a module block (e.g. debug) on a headless workspace', () => {
    const workspace = new Blockly.Workspace();
    const block = workspace.newBlock(moduleBlockType('debug'));
    block.initSvg = undefined; // headless — no rendering
    expect(block.type).toBe('module_debug');
    expect(block.ansibleModuleFqcn).toBe('ansible.builtin.debug');
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

  it('builds a toolbox containing a Modules category with all catalog blocks', () => {
    const toolbox = buildToolbox();
    const modulesCategory = toolbox.contents.find((c) => c.name === 'Modules');
    expect(modulesCategory).toBeDefined();
    expect(modulesCategory.contents.length).toBe(MODULE_NAMES.length);
  });
});
