// awx-ng: Blockly block definitions for the visual playbook builder.
// Static blocks (play/task/control/raw fallback) + one auto-generated block
// per ansible.builtin module from moduleCatalog.generated.json.
import * as Blockly from 'blockly';
import { registerFieldMultilineInput, FieldMultilineInput } from '@blockly/field-multilineinput';
import moduleCatalog from './moduleCatalog.generated.json';

// The multiline text field is a plugin in Blockly v11 (removed from core).
registerFieldMultilineInput();

const MODULE_BLOCK_PREFIX = 'module_';
const ADD_PARAM_PLACEHOLDER = '';

// Params shown by default for modules whose primary option isn't marked
// "required" in ansible-doc (so e.g. debug still shows `msg`, command shows
// `cmd`). Keeps module blocks small — required + these — while surfacing the
// option people actually reach for. Everything else is added on demand via
// the "add parameter…" dropdown.
const PRIMARY_PARAMS = {
  debug: ['msg'],
  command: ['cmd'],
  shell: ['cmd'],
  copy: ['src', 'dest', 'content'],
  file: ['path', 'state'],
  lineinfile: ['path', 'line'],
  blockinfile: ['path', 'block'],
  user: ['name', 'state'],
  group: ['name', 'state'],
  service: ['name', 'state'],
  systemd: ['name', 'state'],
  systemd_service: ['name', 'state'],
  apt: ['name', 'state'],
  yum: ['name', 'state'],
  dnf: ['name', 'state'],
  package: ['name', 'state'],
  pip: ['name', 'state'],
  get_url: ['url', 'dest'],
  uri: ['url', 'method'],
  set_fact: ['key_value'],
  cron: ['name', 'job'],
};

function moduleBlockType(shortName) {
  return `${MODULE_BLOCK_PREFIX}${shortName}`;
}

function fieldForParam(param) {
  // Fields start blank/unchecked; dropdowns lead with an "(unset)" option
  // (value '') so an untouched field emits nothing at generation time.
  if (param.choices && param.choices.length) {
    const options = [['(unset)', ''], ...param.choices.map((c) => [String(c), String(c)])];
    return new Blockly.FieldDropdown(options);
  }
  if (param.type === 'bool') {
    return new Blockly.FieldCheckbox('FALSE');
  }
  return new Blockly.FieldTextInput('');
}

function appendParamRow(block, param) {
  // Required params are marked with a trailing "*".
  const label = param.required ? `${param.name} *` : param.name;
  block
    .appendDummyInput(`ROW_${param.name}`)
    .appendField(`${label}:`)
    .appendField(fieldForParam(param), param.name);
}

function defineModuleBlocks() {
  moduleCatalog.forEach((mod) => {
    const blockType = moduleBlockType(mod.short_name);
    const paramByName = {};
    mod.params.forEach((p) => { paramByName[p.name] = p; });

    const requiredNames = mod.params.filter((p) => p.required).map((p) => p.name);
    const primary = (PRIMARY_PARAMS[mod.short_name] || []).filter((n) => paramByName[n]);
    let defaultNames = [...new Set([...requiredNames, ...primary])];
    if (defaultNames.length === 0 && mod.params.length) {
      defaultNames = [mod.params[0].name];
    }
    const defaultSet = new Set(defaultNames);
    const optionalNames = mod.params.map((p) => p.name).filter((n) => !defaultSet.has(n));

    Blockly.Blocks[blockType] = {
      init() {
        this.appendDummyInput('HEAD').appendField(mod.short_name, 'MODULE_LABEL');
        this.activeOptional_ = [];
        defaultNames.forEach((name) => appendParamRow(this, paramByName[name]));
        if (optionalNames.length) {
          this.appendDummyInput('ADD_OPT').appendField(
            new Blockly.FieldDropdown(() => this.addOptOptions_()),
            'ADD_PARAM'
          );
          this.getField('ADD_PARAM').setValidator((sel) => this.onAddParam_(sel));
        }
        this.setOutput(true, 'Module');
        this.setColour(210);
        const reqText = requiredNames.length
          ? `Required (*): ${requiredNames.join(', ')}`
          : 'No required parameters';
        this.setTooltip(`${mod.short_description || mod.name}\n${reqText}`);
        // Consumed by the generator (which module?) and importer.
        this.ansibleModuleFqcn = mod.name;
        this.moduleShortName_ = mod.short_name;
      },
      // Dynamic options for the "add parameter…" dropdown: every optional
      // param not already shown.
      addOptOptions_() {
        const opts = [['＋ add parameter…', ADD_PARAM_PLACEHOLDER]];
        optionalNames
          .filter((n) => !this.activeOptional_.includes(n))
          .forEach((n) => opts.push([n, n]));
        return opts;
      },
      onAddParam_(sel) {
        if (sel && sel !== ADD_PARAM_PLACEHOLDER) {
          // Defer the structural change out of the validator tick.
          const name = sel;
          setTimeout(() => this.addOptionalParam(name), 0);
        }
        return ADD_PARAM_PLACEHOLDER; // dropdown snaps back to the placeholder
      },
      // Public: adds an optional param row (used by the dropdown UI and by
      // the importer when a YAML task sets a param that isn't shown by
      // default). Idempotent.
      addOptionalParam(name) {
        if (this.activeOptional_.includes(name) || defaultSet.has(name)) return;
        if (!paramByName[name]) return;
        this.activeOptional_.push(name);
        appendParamRow(this, paramByName[name]);
        if (this.getInput('ADD_OPT')) this.moveInputBefore(`ROW_${name}`, 'ADD_OPT');
      },
      // JSON serialization (sidecar save/load): only the set of added optional
      // params — field values are (de)serialized by Blockly itself, and
      // loadExtraState runs first so the rows exist when values are applied.
      saveExtraState() {
        return this.activeOptional_.length ? { optional: this.activeOptional_ } : null;
      },
      loadExtraState(state) {
        this.activeOptional_ = [];
        ((state && state.optional) || []).forEach((name) => this.addOptionalParam(name));
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
        .appendField('extra (vars, environment, …):');
      this.appendDummyInput()
        .appendField(new FieldMultilineInput(''), 'EXTRA');
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
        .appendField('vars (optional):');
      this.appendDummyInput()
        .appendField(new FieldMultilineInput(''), 'VARS');
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
      this.appendValueInput('MODULE').setCheck('Module').appendField('task →');
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
      this.setTooltip(
        'A single Ansible task. Drag a module block from the Modules category ' +
        'into the "task →" socket.'
      );
    },
  };

  // Escape hatch: preserves any construct not (yet) covered by a typed
  // module/control block — critical for lossless import of existing YAML.
  Blockly.Blocks.raw_task = {
    init() {
      this.appendDummyInput().appendField('raw task (unrecognized module)');
      this.appendDummyInput().appendField(new FieldMultilineInput('debug:\n  msg: unrecognized'), 'RAW_YAML');
      this.setPreviousStatement(true, 'Task');
      this.setNextStatement(true, 'Task');
      this.setColour(0);
      this.setTooltip('Fallback block: holds raw task YAML verbatim (round-trip safety).');
    },
  };

  Blockly.Blocks.raw_yaml = {
    init() {
      this.appendDummyInput().appendField('raw YAML (unrecognized construct)');
      this.appendDummyInput().appendField(new FieldMultilineInput('key: value'), 'RAW_YAML');
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
