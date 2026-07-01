// awx-ng: Blockly block definitions for the visual playbook builder.
// Static blocks (play/task/control/raw fallback) + one auto-generated block
// per ansible.builtin module from moduleCatalog.generated.json.
import * as Blockly from 'blockly';
import moduleCatalog from './moduleCatalog.generated.json';

const MODULE_BLOCK_PREFIX = 'module_';

function moduleBlockType(shortName) {
  return `${MODULE_BLOCK_PREFIX}${shortName}`;
}

function fieldForParam(param) {
  // Deliberately start every field blank/unchecked, ignoring the catalog's
  // `default` — pre-filling with defaults would cause the generator
  // (Section D) to always emit them, even for params the user never
  // touched, silently bloating every generated task.
  if (param.choices && param.choices.length) {
    const options = param.choices.map((c) => [String(c), String(c)]);
    return new Blockly.FieldDropdown(options);
  }
  if (param.type === 'bool') {
    return new Blockly.FieldCheckbox('FALSE');
  }
  return new Blockly.FieldTextInput('');
}

function defineModuleBlocks() {
  moduleCatalog.forEach((mod) => {
    const blockType = moduleBlockType(mod.short_name);
    Blockly.Blocks[blockType] = {
      init() {
        this.appendDummyInput().appendField(mod.short_name, 'MODULE_LABEL');
        mod.params.forEach((param) => {
          const label = param.required ? `${param.name}*` : param.name;
          this.appendDummyInput(`ROW_${param.name}`)
            .appendField(`${label}:`)
            .appendField(fieldForParam(param), param.name);
        });
        this.setOutput(true, 'Module');
        this.setColour(210);
        this.setTooltip(mod.short_description || mod.name);
        // Used by the generator (Section D) to know which module this is
        // and by the importer (Section G) to reconstruct it from YAML.
        this.ansibleModuleFqcn = mod.name;
      },
    };
  });
}

function defineStaticBlocks() {
  Blockly.Blocks.play = {
    init() {
      this.appendDummyInput()
        .appendField('Play')
        .appendField(new Blockly.FieldTextInput('play name'), 'NAME');
      this.appendDummyInput()
        .appendField('hosts:')
        .appendField(new Blockly.FieldTextInput('all'), 'HOSTS');
      this.appendDummyInput()
        .appendField('become')
        .appendField(new Blockly.FieldCheckbox('FALSE'), 'BECOME');
      this.appendDummyInput()
        .appendField('extra (vars, environment, …):')
        .appendField(new Blockly.FieldTextInput(''), 'EXTRA');
      this.appendStatementInput('ROLES').setCheck('Role').appendField('roles');
      this.appendStatementInput('TASKS').setCheck('Task').appendField('tasks');
      this.setColour(120);
      this.setDeletable(true);
      this.setTooltip(
        'An Ansible play — a set of tasks (and/or roles) run against a group ' +
        'of hosts. The "extra" field preserves any play-level keys without a ' +
        'dedicated block yet (e.g. vars:, environment:) as raw YAML.'
      );
    },
  };

  Blockly.Blocks.role_use = {
    init() {
      this.appendDummyInput()
        .appendField('role:')
        .appendField(new Blockly.FieldTextInput('role name'), 'ROLE_NAME');
      this.appendDummyInput()
        .appendField('vars (optional):')
        .appendField(new Blockly.FieldTextInput(''), 'VARS');
      this.setPreviousStatement(true, 'Role');
      this.setNextStatement(true, 'Role');
      this.setColour(290);
      this.setTooltip(
        'Applies a project role to this play (equivalent to an entry in ' +
        'the roles: list). "vars" holds optional role variables as inline YAML.'
      );
    },
  };

  Blockly.Blocks.task = {
    init() {
      this.appendValueInput('MODULE').setCheck('Module').appendField('task:');
      this.appendDummyInput()
        .appendField('name:')
        .appendField(new Blockly.FieldTextInput(''), 'NAME');
      this.appendDummyInput()
        .appendField('when:')
        .appendField(new Blockly.FieldTextInput(''), 'WHEN');
      this.appendDummyInput()
        .appendField('tags:')
        .appendField(new Blockly.FieldTextInput(''), 'TAGS');
      this.appendDummyInput()
        .appendField('notify:')
        .appendField(new Blockly.FieldTextInput(''), 'NOTIFY');
      this.setPreviousStatement(true, 'Task');
      this.setNextStatement(true, 'Task');
      this.setColour(65);
      this.setTooltip('A single Ansible task wrapping one module call.');
    },
  };

  // Escape hatch: preserves any construct not (yet) covered by a typed
  // module/control block — critical for lossless import of existing YAML
  // (Section G). Holds the original YAML snippet verbatim.
  // Note: uses a single-line FieldTextInput (Blockly's multiline field is a
  // separate plugin package, not part of core) — multi-line snippets are
  // stored with escaped newlines and unescaped by the generator/importer.
  Blockly.Blocks.raw_task = {
    init() {
      this.appendDummyInput().appendField('raw task (unrecognized module)');
      this.appendDummyInput()
        .appendField('yaml:')
        .appendField(new Blockly.FieldTextInput('debug: {msg: unrecognized}'), 'RAW_YAML');
      this.setPreviousStatement(true, 'Task');
      this.setNextStatement(true, 'Task');
      this.setColour(0);
      this.setTooltip('Fallback block: holds raw task YAML verbatim (round-trip safety).');
    },
  };

  Blockly.Blocks.raw_yaml = {
    init() {
      this.appendDummyInput().appendField('raw YAML (unrecognized construct)');
      this.appendDummyInput()
        .appendField('yaml:')
        .appendField(new Blockly.FieldTextInput('key: value'), 'RAW_YAML');
      this.setOutput(true, 'Module');
      this.setColour(0);
      this.setTooltip('Fallback block: holds raw YAML verbatim (round-trip safety).');
    },
  };
}

export function registerBlocks() {
  defineStaticBlocks();
  defineModuleBlocks();
}

export { moduleBlockType };
export const MODULE_NAMES = moduleCatalog.map((m) => m.short_name);
