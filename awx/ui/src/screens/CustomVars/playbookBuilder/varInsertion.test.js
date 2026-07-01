import * as Blockly from 'blockly';
import { registerBlocks } from './blocks';
import { insertVariableReference } from './varInsertion';

describe('insertVariableReference', () => {
  let workspace;

  beforeAll(() => { registerBlocks(); });
  beforeEach(() => { workspace = new Blockly.Workspace(); });
  afterEach(() => { workspace.dispose(); });

  it('appends a {{ name }} reference to an empty field', () => {
    const block = workspace.newBlock('module_debug');
    const field = block.getField('msg');
    insertVariableReference(field, 'db_password');
    expect(field.getValue()).toBe('{{ db_password }}');
  });

  it('appends to existing text rather than overwriting it', () => {
    const block = workspace.newBlock('module_debug');
    const field = block.getField('msg');
    field.setValue('password is: ');
    insertVariableReference(field, 'db_password');
    expect(field.getValue()).toBe('password is: {{ db_password }}');
  });
});
