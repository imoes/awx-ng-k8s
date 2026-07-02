// awx-ng: inverse of ansibleGenerator.js — parses existing playbook YAML
// (hand-written or from before this feature existed) and reconstructs it as
// Blockly blocks, so users can open and visually edit files they didn't
// create with the builder. Anything not covered by a typed block (a module
// outside ansible.builtin, an unrecognized task shape like block/rescue, or
// play-level keys without a dedicated block yet) is preserved verbatim via
// the raw_task/EXTRA escape hatches — no data loss on import.
import * as Blockly from 'blockly';
import yaml from 'js-yaml';
import { moduleBlockType, MODULE_NAMES, ENVELOPE_FIELDS } from './blocks';

const KNOWN_PLAY_KEYS = new Set(['name', 'hosts', 'become', 'tasks', 'roles']);
// A task's module key is whatever remains after removing "name" and every
// task-level modifier keyword (when/tags/notify/register/become/…) — NOT
// simply "the first unrecognized key", which used to misfire whenever a
// task had more than one modifier (e.g. loop + register together would
// make the importer mistake "loop" for the module and raw_task the rest).
// `with_items` is the legacy predecessor of `loop:` (still common in older
// playbooks) — treated as an alias so those tasks don't need the modern
// keyword to be recognized.
const KNOWN_TASK_ENVELOPE_KEYS = new Set([
  'name', 'with_items', ...ENVELOPE_FIELDS.map((e) => e.yamlKey),
]);
const MODULE_NAME_SET = new Set(MODULE_NAMES);

function newBlock(workspace, type) {
  const block = workspace.newBlock(type);
  // initSvg/render only exist on rendered (browser) workspaces — guard so
  // this also works against a headless Blockly.Workspace() in jest tests.
  if (typeof block.initSvg === 'function') {
    block.initSvg();
    block.render();
  }
  return block;
}

function setField(block, fieldName, value) {
  const field = block.getField(fieldName);
  if (!field) return;
  if (field instanceof Blockly.FieldCheckbox) {
    field.setValue(value ? 'TRUE' : 'FALSE');
  } else if (value !== null && typeof value === 'object') {
    // List/dict-typed param values (e.g. apt's `name: [nginx, curl]`) — dump
    // to YAML text rather than JS's `String([...])`/`"[object Object]"`, so
    // the field holds a value the generator's coerceModuleArgValue() (and a
    // human) can actually parse back.
    field.setValue(yaml.dump(value).trim());
  } else {
    field.setValue(String(value));
  }
}

// Parses Ansible's inline "key=value" shorthand (e.g.
// `file: path=/tmp/x state=directory mode=0755`) into a plain object.
// Values may be quoted. Returns {} if nothing key=value-shaped is found
// (e.g. a bare free-form command like `command: ls -la`).
function parseInlineArgs(str) {
  const result = {};
  const re = /(\w+)=("[^"]*"|'[^']*'|\S+)/g;
  let m = re.exec(str);
  while (m !== null) {
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[m[1]] = value;
    m = re.exec(str);
  }
  return result;
}

// Builds a module_<name> block (which IS the task block — see blocks.js) if
// the module is in the ansible.builtin catalog AND every arg key maps to a
// known param with a scalar value; otherwise returns null so the caller
// falls back to raw_task (lossless).
function importModuleBlock(workspace, moduleKey, args) {
  const shortName = moduleKey.includes('.') ? moduleKey.split('.').pop() : moduleKey;
  // Ansible accepts args as a mapping OR as an inline "key=value" string —
  // normalize the inline form so those tasks still get a typed module block.
  let normalizedArgs = args;
  if (typeof args === 'string') {
    const inline = parseInlineArgs(args);
    if (Object.keys(inline).length) normalizedArgs = inline;
  }
  const argEntries = normalizedArgs && typeof normalizedArgs === 'object' && !Array.isArray(normalizedArgs)
    ? Object.entries(normalizedArgs)
    : null;

  if (!MODULE_NAME_SET.has(shortName) || (!argEntries && args !== null && args !== undefined)) {
    return null;
  }

  const moduleBlock = newBlock(workspace, moduleBlockType(shortName));
  const paramTypes = moduleBlock.paramTypes_ || {};
  // Optional params aren't shown by default — add their rows before setting
  // values. A non-scalar value (array/object) is only representable when the
  // param's own ansible-doc type declares it (list/dict/raw) — e.g. apt's
  // `name: [nginx, curl]` — since the field will parse it back via that same
  // type (see coerceModuleArgValue). An array/object on an otherwise
  // scalar-typed param is unexpected input we can't represent faithfully.
  const isScalar = (v) => v === null || v === undefined || typeof v !== 'object';
  const canRepresent = (argEntries || []).every(([key, value]) => {
    if (!isScalar(value)) {
      const declaredType = paramTypes[key];
      if (declaredType !== 'list' && declaredType !== 'dict' && declaredType !== 'raw') {
        return false;
      }
    }
    if (moduleBlock.getField(key)) return true;
    moduleBlock.addOptionalParam(key);
    return !!moduleBlock.getField(key);
  });
  if (!canRepresent) {
    moduleBlock.dispose();
    return null;
  }
  (argEntries || []).forEach(([key, value]) => setField(moduleBlock, key, value));
  return moduleBlock;
}

function importTask(workspace, taskObj) {
  const moduleKeys = Object.keys(taskObj).filter((k) => !KNOWN_TASK_ENVELOPE_KEYS.has(k));

  // Zero or more-than-one remaining key: can't unambiguously identify the
  // module (e.g. block:/rescue:/always:, or an empty task) — preserve the
  // whole task verbatim rather than guessing wrong.
  const moduleBlock = moduleKeys.length === 1
    ? importModuleBlock(workspace, moduleKeys[0], taskObj[moduleKeys[0]])
    : null;

  if (!moduleBlock) {
    const rawTask = newBlock(workspace, 'raw_task');
    setField(rawTask, 'RAW_YAML', yaml.dump(taskObj).trim());
    return rawTask;
  }

  if (taskObj.name) setField(moduleBlock, 'NAME', taskObj.name);
  ENVELOPE_FIELDS.forEach((envelope) => {
    // `with_items` is the legacy alias for `loop:` (see KNOWN_TASK_ENVELOPE_KEYS) —
    // both populate the same LOOP field; regeneration always emits `loop:`.
    const sourceKey = envelope.key === 'LOOP' && !('loop' in taskObj) && 'with_items' in taskObj
      ? 'with_items'
      : envelope.yamlKey;
    if (!(sourceKey in taskObj)) return;
    let value = taskObj[sourceKey];
    if (envelope.key === 'TAGS' || envelope.key === 'NOTIFY') {
      value = Array.isArray(value) ? value.join(', ') : value;
    } else if (envelope.key === 'LOOP' && typeof value !== 'string') {
      value = yaml.dump(value).trim();
    }
    moduleBlock.addEnvelopeField(envelope.key);
    setField(moduleBlock, envelope.key, value);
  });
  return moduleBlock;
}

// A `roles:` entry is either a plain role name string, or an object
// `{role: name, ...vars}` — the inverse of ansibleGenerator's
// blockToRoleObject().
function importRole(workspace, roleEntry) {
  const roleBlock = newBlock(workspace, 'role_use');
  if (typeof roleEntry === 'string') {
    setField(roleBlock, 'ROLE_NAME', roleEntry);
  } else if (roleEntry && typeof roleEntry === 'object') {
    const { role, ...roleVars } = roleEntry;
    setField(roleBlock, 'ROLE_NAME', role);
    if (Object.keys(roleVars).length) {
      setField(roleBlock, 'VARS', yaml.dump(roleVars).trim());
    }
  }
  return roleBlock;
}

function importPlay(workspace, playObj) {
  const playBlock = newBlock(workspace, 'play');
  if (playObj.name) setField(playBlock, 'NAME', playObj.name);
  if (playObj.hosts) setField(playBlock, 'HOSTS', playObj.hosts);
  if (playObj.become) setField(playBlock, 'BECOME', true);

  const extraKeys = Object.keys(playObj).filter((k) => !KNOWN_PLAY_KEYS.has(k));
  if (extraKeys.length) {
    const extra = {};
    extraKeys.forEach((k) => { extra[k] = playObj[k]; });
    setField(playBlock, 'EXTRA', yaml.dump(extra).trim());
  }

  let previousRole = null;
  (playObj.roles || []).forEach((roleEntry) => {
    const roleBlock = importRole(workspace, roleEntry);
    if (previousRole) {
      previousRole.nextConnection.connect(roleBlock.previousConnection);
    } else {
      playBlock.getInput('ROLES').connection.connect(roleBlock.previousConnection);
    }
    previousRole = roleBlock;
  });

  let previousTask = null;
  (playObj.tasks || []).forEach((taskObj) => {
    const taskBlock = importTask(workspace, taskObj);
    if (previousTask) {
      previousTask.nextConnection.connect(taskBlock.previousConnection);
    } else {
      playBlock.getInput('TASKS').connection.connect(taskBlock.previousConnection);
    }
    previousTask = taskBlock;
  });

  return playBlock;
}

// Parses playbook YAML (a top-level list of plays) and rebuilds it as
// blocks on `workspace`, replacing whatever is currently on it. Returns the
// number of plays imported.
export function importPlaybookYaml(content, workspace) {
  const plays = yaml.load(content);
  if (!Array.isArray(plays)) {
    throw new Error('Expected a YAML list of plays at the top level.');
  }
  workspace.clear();
  plays.forEach((playObj, index) => {
    const playBlock = importPlay(workspace, playObj);
    // Fixed vertical spacing between top-level plays — precise layout isn't
    // functionally important (only generation correctness is), just enough
    // to keep multiple imported plays from rendering on top of each other.
    if (typeof playBlock.moveBy === 'function') {
      playBlock.moveBy(20, 20 + index * 400);
    }
  });
  return plays.length;
}

// Role-tasks document mode: a role's tasks/main.yml is a bare list of tasks.
// Rebuilds it as a single top-level stack of module/raw_task blocks (no play
// wrapper), the inverse of ansibleGenerator's workspaceToTasks().
export function importTasksYaml(content, workspace) {
  const tasks = yaml.load(content);
  if (!Array.isArray(tasks)) {
    throw new Error('Expected a YAML list of tasks at the top level.');
  }
  workspace.clear();
  let previousTask = null;
  tasks.forEach((taskObj, index) => {
    const taskBlock = importTask(workspace, taskObj);
    if (previousTask) {
      previousTask.nextConnection.connect(taskBlock.previousConnection);
    } else if (typeof taskBlock.moveBy === 'function') {
      taskBlock.moveBy(20, 20);
    }
    previousTask = taskBlock;
    return index;
  });
  return tasks.length;
}
