// awx-ng: builds the Blockly toolbox (palette) for the playbook builder.
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

export function buildToolbox() {
  return {
    kind: 'categoryToolbox',
    contents: [
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
