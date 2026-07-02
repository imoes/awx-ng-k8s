// awx-ng: Blockly block definitions for the visual playbook builder.
// Static blocks (play/role/raw fallback) + one auto-generated block per
// ansible.builtin module from moduleCatalog.generated.json.
//
// Module blocks double as task blocks (no separate "task" wrapper): every
// module_<name> block is itself a statement block with a `name:` field and
// can plug directly into a play's tasks stack. Task-level modifiers
// (when/tags/notify/register/become/ignore_errors/delegate_to/loop) are
// available via the same "add parameter…" dropdown as the module's own
// optional arguments — one consolidated place to add anything.
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

// Common Ansible task-level keywords, offered on every module block via the
// same "add parameter…" dropdown as the module's own optional args. Field
// ids are ALL-CAPS so they can never collide with a lowercase module
// parameter name (ansible-doc param names are always lowercase).
export const ENVELOPE_FIELDS = [
  { key: 'WHEN', label: 'when', yamlKey: 'when', makeField: () => new Blockly.FieldTextInput('') },
  { key: 'TAGS', label: 'tags', yamlKey: 'tags', makeField: () => new Blockly.FieldTextInput('') },
  { key: 'NOTIFY', label: 'notify', yamlKey: 'notify', makeField: () => new Blockly.FieldTextInput('') },
  { key: 'REGISTER', label: 'register', yamlKey: 'register', makeField: () => new Blockly.FieldTextInput('') },
  { key: 'LOOP', label: 'loop', yamlKey: 'loop', makeField: () => new FieldMultilineInput('') },
  { key: 'DELEGATE_TO', label: 'delegate_to', yamlKey: 'delegate_to', makeField: () => new Blockly.FieldTextInput('') },
  { key: 'BECOME', label: 'become', yamlKey: 'become', makeField: () => new Blockly.FieldCheckbox('FALSE') },
  { key: 'IGNORE_ERRORS', label: 'ignore_errors', yamlKey: 'ignore_errors', makeField: () => new Blockly.FieldCheckbox('FALSE') },
];
const ENVELOPE_BY_KEY = {};
ENVELOPE_FIELDS.forEach((e) => { ENVELOPE_BY_KEY[e.key] = e; });

// Every field id that is part of the fixed task "envelope" or block
// scaffolding — never a module argument. Used by the generator to know
// which fields to skip when collecting a module's own args.
export const RESERVED_FIELD_NAMES = new Set([
  'MODULE_LABEL', 'ADD_PARAM', 'NAME',
  ...ENVELOPE_FIELDS.map((e) => e.key),
]);

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

function appendEnvelopeRow(block, envelope) {
  block
    .appendDummyInput(`ROW_${envelope.key}`)
    .appendField(`${envelope.label}:`)
    .appendField(envelope.makeField(), envelope.key);
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
        this.appendDummyInput('ROW_NAME')
          .appendField('name:')
          .appendField(new Blockly.FieldTextInput(''), 'NAME');
        this.activeOptional_ = [];
        this.activeEnvelope_ = [];
        defaultNames.forEach((name) => appendParamRow(this, paramByName[name]));
        this.appendDummyInput('ADD_OPT').appendField(
          new Blockly.FieldDropdown(() => this.addOptOptions_()),
          'ADD_PARAM'
        );
        this.getField('ADD_PARAM').setValidator((sel) => this.onAddParam_(sel));
        // A module block IS a task — plugs directly into a play's tasks
        // stack (or a role's bare task list). No separate wrapper needed.
        this.setPreviousStatement(true, 'Task');
        this.setNextStatement(true, 'Task');
        this.setColour(210);
        const reqText = requiredNames.length
          ? `Required (*): ${requiredNames.join(', ')}`
          : 'No required parameters';
        this.setTooltip(`${mod.short_description || mod.name}\n${reqText}`);
        // Consumed by the generator (which module?) and importer.
        this.ansibleModuleFqcn = mod.name;
        this.moduleShortName_ = mod.short_name;
      },
      // Dynamic options for the "add parameter…" dropdown: remaining
      // optional module params + task-level modifiers (when/tags/register/…)
      // not already shown — one consolidated place to add either kind.
      addOptOptions_() {
        const opts = [['＋ add parameter…', ADD_PARAM_PLACEHOLDER]];
        optionalNames
          .filter((n) => !this.activeOptional_.includes(n))
          .forEach((n) => opts.push([n, `mod:${n}`]));
        ENVELOPE_FIELDS
          .filter((e) => !this.activeEnvelope_.includes(e.key))
          .forEach((e) => opts.push([e.label, `env:${e.key}`]));
        return opts;
      },
      onAddParam_(sel) {
        if (sel && sel !== ADD_PARAM_PLACEHOLDER) {
          const [kind, key] = sel.split(':');
          // Defer the structural change out of the validator tick.
          setTimeout(() => {
            if (kind === 'mod') this.addOptionalParam(key);
            else if (kind === 'env') this.addEnvelopeField(key);
          }, 0);
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
        this.moveInputBefore(`ROW_${name}`, 'ADD_OPT');
      },
      // Public: adds a task-level modifier row (when/tags/register/…).
      // Idempotent.
      addEnvelopeField(key) {
        if (this.activeEnvelope_.includes(key)) return;
        const envelope = ENVELOPE_BY_KEY[key];
        if (!envelope) return;
        this.activeEnvelope_.push(key);
        appendEnvelopeRow(this, envelope);
        this.moveInputBefore(`ROW_${key}`, 'ADD_OPT');
      },
      // JSON serialization (sidecar save/load): only the sets of added
      // optional/envelope fields — field values are (de)serialized by
      // Blockly itself, and loadExtraState runs first so the rows exist
      // when values are applied.
      saveExtraState() {
        if (!this.activeOptional_.length && !this.activeEnvelope_.length) return null;
        return { optional: this.activeOptional_, envelope: this.activeEnvelope_ };
      },
      loadExtraState(state) {
        this.activeOptional_ = [];
        this.activeEnvelope_ = [];
        ((state && state.optional) || []).forEach((name) => this.addOptionalParam(name));
        ((state && state.envelope) || []).forEach((key) => this.addEnvelopeField(key));
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

  // Escape hatch: preserves any task shape not covered by a typed module
  // block — critical for lossless import of existing YAML (unrecognized
  // modules, block:/rescue:/always:, or task-level keys we don't model).
  Blockly.Blocks.raw_task = {
    init() {
      this.appendDummyInput().appendField('raw task (unrecognized shape)');
      this.appendDummyInput().appendField(new FieldMultilineInput('debug:\n  msg: unrecognized'), 'RAW_YAML');
      this.setPreviousStatement(true, 'Task');
      this.setNextStatement(true, 'Task');
      this.setColour(0);
      this.setTooltip('Fallback block: holds raw task YAML verbatim (round-trip safety).');
    },
  };
}

export function registerBlocks() {
  defineStaticBlocks();
  defineModuleBlocks();
}

export { moduleBlockType };
export const MODULE_NAMES = moduleCatalog.map((m) => m.short_name);
