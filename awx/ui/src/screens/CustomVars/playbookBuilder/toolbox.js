// awx-ng: builds the Blockly toolbox (palette) for the playbook builder.
// Live search is scoped per-category (see FlyoutFilter.js) rather than using
// @blockly/toolbox-search's global "search everything" category, which
// mixed modules and roles together in one result list.
import moduleCatalog from './moduleCatalog.generated.json';
import { moduleBlockType } from './blocks';

export const MODULES_CATEGORY_NAME = 'Modules';
export const ROLES_CATEGORY_NAME = 'Roles';

function moduleCategory() {
  return {
    kind: 'category',
    name: MODULES_CATEGORY_NAME,
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
    name: ROLES_CATEGORY_NAME,
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
        kind: 'category',
        name: 'Play',
        colour: '120',
        contents: [{ kind: 'block', type: 'play' }],
      },
      moduleCategory(),
      rolesCategory(roleNames),
      {
        kind: 'category',
        name: 'Raw / Fallback',
        colour: '0',
        contents: [
          { kind: 'block', type: 'raw_task' },
        ],
      },
    ],
  };
}
