// awx-ng: walks a Blockly workspace and serializes it to Ansible playbook
// YAML. Deliberately NOT using Blockly's built-in string-concatenating code
// generator (fragile for context-sensitive YAML indentation) — instead we
// build a plain JS object tree (`plays[]`) and hand it to the same
// jsonToYaml() the rest of AWX-ng already uses for extra_vars.
import * as Blockly from 'blockly';
import yaml from 'js-yaml';
import { jsonToYaml } from 'util/yaml';
import { RESERVED_FIELD_NAMES, ENVELOPE_FIELDS } from './blocks';

function fieldValue(block, fieldName) {
  const field = block.getField(fieldName);
  if (!field) return undefined;
  const raw = field.getValue();
  if (field instanceof Blockly.FieldCheckbox) {
    return raw === 'TRUE';
  }
  return raw;
}

// Parses a YAML-text field but returns a value only when it's a plain
// mapping. Guards against e.g. a bare string ("cmk_hostname") whose
// yaml.load() is a string — spreading/assigning that produces character-
// indexed junk keys ({0:'c',1:'m',...}). Returns null for anything that
// isn't a plain object.
function parseYamlMapping(text) {
  if (!text) return null;
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

// Converts a field's raw text into the shape its ansible-doc param type
// expects. Every module param field is a flat text/dropdown/checkbox
// control (see blocks.js), so list/dict-typed params (e.g. apt/yum/dnf's
// `name: [nginx, curl]`, a common multi-package install) need their text
// parsed into a real array/object rather than being emitted as one literal
// string — that mismatch used to force those tasks into the raw_task
// fallback entirely (see playbookImporter.js).
function coerceModuleArgValue(rawValue, paramType) {
  if (paramType === 'int' || paramType === 'float') {
    const n = Number(rawValue);
    return Number.isNaN(n) ? rawValue : n;
  }
  if (paramType === 'list') {
    // Accept either full YAML list syntax (multi-line "- item" or "[a, b]")
    // or a quick comma-separated shorthand, same convention as tags/notify.
    try {
      const parsed = yaml.load(rawValue);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through to comma-split */ }
    return String(rawValue).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (paramType === 'dict') {
    return parseYamlMapping(rawValue) || rawValue;
  }
  if (paramType === 'raw') {
    // 'raw' means "accepts anything" — use the parsed structure only when it
    // actually is one; otherwise keep the original string untouched (a bare
    // string parses back to itself anyway via yaml.load, so this is safe).
    try {
      const parsed = yaml.load(rawValue);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* keep as string */ }
    return rawValue;
  }
  return rawValue; // str / path / bool(already coerced by fieldValue)
}

function blockToModuleArgs(moduleBlock) {
  const args = {};
  const paramTypes = moduleBlock.paramTypes_ || {};
  moduleBlock.inputList.forEach((input) => {
    input.fieldRow.forEach((field) => {
      // Skip the module header/add-dropdown and every task-envelope field
      // (name/when/tags/…) — only the module's OWN arguments belong here.
      if (!field.name || RESERVED_FIELD_NAMES.has(field.name)) return;
      const value = fieldValue(moduleBlock, field.name);
      // Blank text fields and unchecked checkboxes mean "the user didn't
      // set this" — there's no separate UI affordance (yet) to distinguish
      // "explicitly false" from "left at the field's blank default", so we
      // omit both to avoid bloating every generated task with untouched
      // params (see blocks.js: fields intentionally start blank/unchecked).
      if (value === '' || value === null || value === undefined || value === false) return;
      args[field.name] = coerceModuleArgValue(value, paramTypes[field.name]);
    });
  });
  return args;
}

// A module block IS a task (see blocks.js) — this walks its own name/module-
// args/envelope fields into one ordered task object. raw_task holds an
// entire unrecognized task verbatim.
function blockToTaskObject(taskBlock) {
  if (taskBlock.type === 'raw_task') {
    const raw = fieldValue(taskBlock, 'RAW_YAML') || '';
    return yaml.load(raw) || {};
  }

  const shortName = taskBlock.moduleShortName_
    || (taskBlock.ansibleModuleFqcn ? taskBlock.ansibleModuleFqcn.split('.').pop() : taskBlock.type.replace(/^module_/, ''));
  const name = fieldValue(taskBlock, 'NAME');

  const ordered = {};
  if (name) ordered.name = name;
  ordered[shortName] = blockToModuleArgs(taskBlock);

  ENVELOPE_FIELDS.forEach((envelope) => {
    const value = fieldValue(taskBlock, envelope.key);
    if (value === '' || value === null || value === undefined || value === false) return;
    if (envelope.key === 'BECOME' || envelope.key === 'IGNORE_ERRORS') {
      ordered[envelope.yamlKey] = true;
    } else if (envelope.key === 'TAGS' || envelope.key === 'NOTIFY') {
      ordered[envelope.yamlKey] = String(value).split(',').map((t) => t.trim()).filter(Boolean);
    } else if (envelope.key === 'LOOP') {
      // loop is assigned directly (not spread), so a bare scalar is safe —
      // no repeat of the EXTRA/VARS char-spread bug from a plain string.
      ordered[envelope.yamlKey] = yaml.load(value);
    } else {
      ordered[envelope.yamlKey] = value;
    }
  });

  return ordered;
}

function blockToRoleObject(roleBlock) {
  const name = fieldValue(roleBlock, 'ROLE_NAME');
  const roleVars = parseYamlMapping(fieldValue(roleBlock, 'VARS'));
  if (!roleVars) return name;
  return { role: name, ...roleVars };
}

function blockToPlayObject(playBlock) {
  const name = fieldValue(playBlock, 'NAME');
  const hosts = fieldValue(playBlock, 'HOSTS');
  const become = fieldValue(playBlock, 'BECOME');
  const extra = fieldValue(playBlock, 'EXTRA');

  const roles = [];
  let roleBlock = playBlock.getInputTargetBlock('ROLES');
  while (roleBlock) {
    if (roleBlock.isEnabled()) {
      roles.push(blockToRoleObject(roleBlock));
    }
    roleBlock = roleBlock.getNextBlock();
  }

  const tasks = [];
  let taskBlock = playBlock.getInputTargetBlock('TASKS');
  while (taskBlock) {
    if (taskBlock.isEnabled()) {
      tasks.push(blockToTaskObject(taskBlock));
    }
    taskBlock = taskBlock.getNextBlock();
  }

  const play = { name, hosts };
  if (become) play.become = true;
  // Play-level keys without a dedicated block yet (environment:, vars:,
  // ...) round-trip verbatim through this field — see blocks.js. `roles:`
  // has its own typed role_use blocks (below), not part of EXTRA.
  const extraObj = parseYamlMapping(extra);
  if (extraObj) Object.assign(play, extraObj);
  if (roles.length) play.roles = roles;
  play.tasks = tasks;
  return play;
}

export function workspaceToPlays(workspace) {
  return workspace
    .getTopBlocks(true)
    .filter((block) => block.type === 'play' && block.isEnabled())
    .map(blockToPlayObject);
}

// Role-tasks document mode: a role's tasks/main.yml is a bare list of tasks
// (no play wrapper). Collect every top-level module/raw_task stack in order.
export function workspaceToTasks(workspace) {
  const tasks = [];
  workspace.getTopBlocks(true).forEach((top) => {
    let block = top;
    while (block) {
      const isTaskLike = block.type === 'raw_task' || block.type.startsWith('module_');
      if (block.isEnabled() && isTaskLike) {
        tasks.push(blockToTaskObject(block));
      }
      block = block.getNextBlock();
    }
  });
  return tasks;
}

export function workspaceToPlaybook(workspace) {
  const plays = workspaceToPlays(workspace);
  return jsonToYaml(JSON.stringify(plays));
}

// Serializes the workspace for the active document mode:
//   'playbook' → list of plays;  'role' → bare list of tasks.
export function serializeWorkspace(workspace, mode = 'playbook') {
  const doc = mode === 'role' ? workspaceToTasks(workspace) : workspaceToPlays(workspace);
  return jsonToYaml(JSON.stringify(doc));
}
