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

  it('builds a toolbox containing a Modules category with all catalog blocks', () => {
    const toolbox = buildToolbox();
    const modulesCategory = toolbox.contents.find((c) => c.name === 'Modules');
    expect(modulesCategory).toBeDefined();
    expect(modulesCategory.contents.length).toBe(MODULE_NAMES.length);
  });
});
