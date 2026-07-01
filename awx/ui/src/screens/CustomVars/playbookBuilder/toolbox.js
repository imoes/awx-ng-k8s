// awx-ng: builds the Blockly toolbox (palette) for the playbook builder.
// Importing the plugin registers the `kind: 'search'` toolbox category, which
// adds a live search box that filters blocks (modules, roles, …) as you type.
import '@blockly/toolbox-search';
import moduleCatalog from './moduleCatalog.generated.json';
import { moduleBlockType } from './blocks';

function moduleCategory() {
  return {
    kind: 'category',
    name: 'Modules',
    colour: '210',
    contents: [...moduleCatalog]
      .sort((a, b) => a.short_name.localeCompare(b.short_name))
      .map((mod) => ({ kind: 'block', type: moduleBlockType(mod.short_name) })),
  };
}

// Roles are per-project (unlike the static ansible.builtin catalog), so the
// caller passes the current project's role names; each becomes a `role_use`
// flyout entry pre-filled with that role's name via the toolbox JSON's
// `fields` override, letting the user drag out an already-labeled block.
function rolesCategory(roleNames) {
  return {
    kind: 'category',
    name: 'Roles',
    colour: '290',
    contents: roleNames.length
      ? [...roleNames].sort().map((name) => ({
          kind: 'block',
          type: 'role_use',
          fields: { ROLE_NAME: name },
        }))
      : [{ kind: 'block', type: 'role_use' }],
  };
}

export function buildToolbox(roleNames = []) {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        // Live search across all catalogued blocks (modules, roles, …).
        kind: 'search',
        name: '🔍 Search',
        contents: [],
      },
      {
        kind: 'category',
        name: 'Play',
        colour: '120',
        contents: [{ kind: 'block', type: 'play' }],
      },
      {
        kind: 'category',
        name: 'Task',
        colour: '65',
        contents: [{ kind: 'block', type: 'task' }],
      },
      moduleCategory(),
      rolesCategory(roleNames),
      {
        kind: 'category',
        name: 'Raw / Fallback',
        colour: '0',
        contents: [
          { kind: 'block', type: 'raw_task' },
          { kind: 'block', type: 'raw_yaml' },
        ],
      },
    ],
  };
}
