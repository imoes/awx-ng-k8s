// awx-ng: inverse of ansibleGenerator.js — parses existing playbook YAML
// (hand-written or from before this feature existed) and reconstructs it as
// Blockly blocks, so users can open and visually edit files they didn't
// create with the builder. Anything not covered by a typed block (a module
// outside ansible.builtin, an unrecognized task shape like block/rescue, or
// play-level keys without a dedicated block yet) is preserved verbatim via
// the raw_task/raw_yaml/EXTRA escape hatches — no data loss on import.
import * as Blockly from 'blockly';
import yaml from 'js-yaml';
import { moduleBlockType, MODULE_NAMES } from './blocks';

const KNOWN_PLAY_KEYS = new Set(['name', 'hosts', 'become', 'tasks', 'roles']);
const KNOWN_TASK_KEYS = new Set(['name', 'when', 'tags', 'notify']);
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

// Builds the block that plugs into a task's MODULE input: a typed
// `module_<name>` block if the module is in the ansible.builtin catalog AND
// all its arg keys map to known params; otherwise a `raw_yaml` fallback
// holding `{moduleKey: args}` verbatim (lossless).
function importModuleSlot(workspace, moduleKey, args) {
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

  if (MODULE_NAME_SET.has(shortName) && (argEntries || args === null || args === undefined)) {
    const moduleBlock = newBlock(workspace, moduleBlockType(shortName));
    // Optional params aren't shown by default — add their rows before
    // setting values. If a key isn't a known param of this module, we can't
    // represent it faithfully, so fall back to raw_yaml (no data loss).
    const isScalar = (v) => v === null || v === undefined || typeof v !== 'object';
    const canRepresent = (argEntries || []).every(([key, value]) => {
      // Non-scalar values (nested dict/list) can't live in a text field.
      if (!isScalar(value)) return false;
      if (moduleBlock.getField(key)) return true;
      if (typeof moduleBlock.addOptionalParam === 'function') {
        moduleBlock.addOptionalParam(key);
        return !!moduleBlock.getField(key);
      }
      return false;
    });
    if (canRepresent) {
      (argEntries || []).forEach(([key, value]) => setField(moduleBlock, key, value));
      return moduleBlock;
    }
    moduleBlock.dispose();
  }

  const rawBlock = newBlock(workspace, 'raw_yaml');
  setField(rawBlock, 'RAW_YAML', yaml.dump({ [moduleKey]: args }).trim());
  return rawBlock;
}

function importTask(workspace, taskObj) {
  const moduleKey = Object.keys(taskObj).find((k) => !KNOWN_TASK_KEYS.has(k));

  // No module key (e.g. block:/rescue:/always:, or an empty task) — no
  // typed shape for this yet; preserve the whole task verbatim.
  if (!moduleKey) {
    const rawTask = newBlock(workspace, 'raw_task');
    setField(rawTask, 'RAW_YAML', yaml.dump(taskObj).trim());
    return rawTask;
  }

  const moduleSlot = importModuleSlot(workspace, moduleKey, taskObj[moduleKey]);
  if (moduleSlot.type === 'raw_yaml') {
    // Unrecognized module: fold the whole task (incl. name/when/tags/notify)
    // into one raw_task rather than a typed task wrapping a raw module —
    // simpler and equally lossless.
    moduleSlot.dispose();
    const rawTask = newBlock(workspace, 'raw_task');
    setField(rawTask, 'RAW_YAML', yaml.dump(taskObj).trim());
    return rawTask;
  }

  const taskBlock = newBlock(workspace, 'task');
  if (taskObj.name) setField(taskBlock, 'NAME', taskObj.name);
  if (taskObj.when) setField(taskBlock, 'WHEN', taskObj.when);
  if (taskObj.tags) {
    setField(taskBlock, 'TAGS', Array.isArray(taskObj.tags) ? taskObj.tags.join(', ') : taskObj.tags);
  }
  if (taskObj.notify) {
    setField(taskBlock, 'NOTIFY', Array.isArray(taskObj.notify) ? taskObj.notify.join(', ') : taskObj.notify);
  }
  taskBlock.getInput('MODULE').connection.connect(moduleSlot.outputConnection);
  return taskBlock;
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
// Rebuilds it as a single top-level stack of task/raw_task blocks (no play
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
