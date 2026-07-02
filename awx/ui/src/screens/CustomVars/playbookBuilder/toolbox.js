// awx-ng: builds the Blockly toolbox (palette) for the playbook builder.
//
// Live search is scoped to the *open* category (Modules or Roles) rather than
// using @blockly/toolbox-search's global "search everything" category, which
// mixed modules and roles into one result list. The Modules and Roles
// categories are DYNAMIC (Blockly `custom` callbacks): each rebuilds its
// flyout from the current palette-filter string. Since only one category is
// open at a time, the single filter box only ever narrows that category.
import moduleCatalog from './moduleCatalog.generated.json';
import { moduleBlockType, CONDITION_BLOCK_TYPES, TASK_SETTING_BLOCK_TYPES } from './blocks';

export const MODULES_CATEGORY_NAME = 'Modules';
export const ROLES_CATEGORY_NAME = 'Roles';
export const MODULE_SEARCH_CALLBACK = 'MODULE_SEARCH';
export const ROLE_SEARCH_CALLBACK = 'ROLE_SEARCH';

const SORTED_MODULES = [...moduleCatalog].sort((a, b) =>
  a.short_name.localeCompare(b.short_name)
);

export function buildToolbox() {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Play',
        colour: '120',
        contents: [{ kind: 'block', type: 'play' }, { kind: 'block', type: 'define_var' }],
      },
      {
        kind: 'category',
        name: MODULES_CATEGORY_NAME,
        colour: '210',
        custom: MODULE_SEARCH_CALLBACK,
      },
      {
        kind: 'category',
        name: ROLES_CATEGORY_NAME,
        colour: '290',
        custom: ROLE_SEARCH_CALLBACK,
      },
      {
        kind: 'category',
        name: 'Conditions',
        colour: '210',
        contents: CONDITION_BLOCK_TYPES.map((type) => ({ kind: 'block', type })),
      },
      {
        kind: 'category',
        name: 'Task Settings',
        colour: '230',
        contents: TASK_SETTING_BLOCK_TYPES.map((type) => ({ kind: 'block', type })),
      },
      {
        kind: 'category',
        name: 'Raw / Fallback',
        colour: '0',
        contents: [{ kind: 'block', type: 'raw_task' }],
      },
    ],
  };
}

// Filtered flyout contents for the Modules category (used by the custom
// category callback and unit-testable on its own).
export function moduleFlyoutContents(filter) {
  const f = (filter || '').trim().toLowerCase();
  return SORTED_MODULES
    .filter((mod) => !f || mod.short_name.toLowerCase().includes(f))
    .map((mod) => ({ kind: 'block', type: moduleBlockType(mod.short_name) }));
}

// Filtered flyout contents for the Roles category. Roles are per-project, so
// the current project's role names are passed in; each becomes a role_use
// flyout entry pre-filled with that role's name.
export function roleFlyoutContents(roleNames, filter) {
  const f = (filter || '').trim().toLowerCase();
  const matched = [...roleNames].sort()
    .filter((name) => !f || name.toLowerCase().includes(f));
  if (!matched.length) {
    // No project roles (or none match) — still offer a blank role_use block.
    return [{ kind: 'block', type: 'role_use' }];
  }
  return matched.map((name) => ({
    kind: 'block',
    type: 'role_use',
    fields: { ROLE_NAME: name },
  }));
}

// Registers the dynamic-category callbacks on a workspace. `getFilter` and
// `getRoleNames` are read live (via refs) each time a category flyout opens
// or is refreshed, so typing in the filter box + refreshSelection() re-filters
// the open flyout without rebuilding the whole toolbox.
export function registerCategoryCallbacks(workspace, { getFilter, getRoleNames }) {
  workspace.registerToolboxCategoryCallback(MODULE_SEARCH_CALLBACK, () =>
    moduleFlyoutContents(getFilter())
  );
  workspace.registerToolboxCategoryCallback(ROLE_SEARCH_CALLBACK, () =>
    roleFlyoutContents(getRoleNames(), getFilter())
  );
}
