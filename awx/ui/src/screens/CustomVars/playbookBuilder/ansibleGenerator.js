// awx-ng: walks a Blockly workspace and serializes it to Ansible playbook
// YAML. Deliberately NOT using Blockly's built-in string-concatenating code
// generator (fragile for context-sensitive YAML indentation) — instead we
// build a plain JS object tree (`plays[]`) and hand it to the same
// jsonToYaml() the rest of AWX-ng already uses for extra_vars.
import * as Blockly from 'blockly';
import yaml from 'js-yaml';
import { jsonToYaml } from 'util/yaml';

function fieldValue(block, fieldName) {
  const field = block.getField(fieldName);
  if (!field) return undefined;
  const raw = field.getValue();
  if (field instanceof Blockly.FieldCheckbox) {
    return raw === 'TRUE';
  }
  return raw;
}

function blockToModuleArgs(moduleBlock) {
  const args = {};
  moduleBlock.inputList.forEach((input) => {
    input.fieldRow.forEach((field) => {
      if (!field.name || field.name === 'MODULE_LABEL') return;
      const value = fieldValue(moduleBlock, field.name);
      // Blank text fields and unchecked checkboxes mean "the user didn't
      // set this" — there's no separate UI affordance (yet) to distinguish
      // "explicitly false" from "left at the field's blank default", so we
      // omit both to avoid bloating every generated task with untouched
      // params (see blocks.js: fields intentionally start blank/unchecked).
      if (value === '' || value === null || value === undefined || value === false) return;
      args[field.name] = value;
    });
  });
  return args;
}

// A module slot (the value input a `task` block plugs into) can hold either
// a typed `module_<name>` block or the `raw_yaml` escape hatch.
function moduleSlotToObject(moduleBlock) {
  if (!moduleBlock) return {};
  if (moduleBlock.type === 'raw_yaml') {
    const raw = fieldValue(moduleBlock, 'RAW_YAML') || '';
    return yaml.load(raw) || {};
  }
  const shortName = moduleBlock.ansibleModuleFqcn
    ? moduleBlock.ansibleModuleFqcn.split('.').pop()
    : moduleBlock.type.replace(/^module_/, '');
  return { [shortName]: blockToModuleArgs(moduleBlock) };
}

function blockToTaskObject(taskBlock) {
  if (taskBlock.type === 'raw_task') {
    const raw = fieldValue(taskBlock, 'RAW_YAML') || '';
    return yaml.load(raw) || {};
  }
  const moduleBlock = taskBlock.getInputTargetBlock('MODULE');
  const task = { ...moduleSlotToObject(moduleBlock) };

  const name = fieldValue(taskBlock, 'NAME');
  const when = fieldValue(taskBlock, 'WHEN');
  const tags = fieldValue(taskBlock, 'TAGS');
  const notify = fieldValue(taskBlock, 'NOTIFY');

  const ordered = {};
  if (name) ordered.name = name;
  Object.assign(ordered, task);
  if (when) ordered.when = when;
  if (tags) {
    ordered.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (notify) ordered.notify = notify;
  return ordered;
}

function blockToPlayObject(playBlock) {
  const name = fieldValue(playBlock, 'NAME');
  const hosts = fieldValue(playBlock, 'HOSTS');
  const become = fieldValue(playBlock, 'BECOME');

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
  play.tasks = tasks;
  return play;
}

export function workspaceToPlays(workspace) {
  return workspace
    .getTopBlocks(true)
    .filter((block) => block.type === 'play' && block.isEnabled())
    .map(blockToPlayObject);
}

export function workspaceToPlaybook(workspace) {
  const plays = workspaceToPlays(workspace);
  return jsonToYaml(JSON.stringify(plays));
}
