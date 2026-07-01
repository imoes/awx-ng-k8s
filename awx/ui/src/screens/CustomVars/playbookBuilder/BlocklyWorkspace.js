// awx-ng: thin React wrapper around Blockly.inject — no react-blockly dependency
// (avoids its React 18 peer-dependency requirement; this project is on React 17).
import React, { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';

function BlocklyWorkspace({ toolbox, initialState, onChange, onWorkspaceReady, style }) {
  const containerRef = useRef(null);
  const workspaceRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const workspace = Blockly.inject(containerRef.current, {
      toolbox,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 1 },
      grid: { spacing: 24, length: 3, colour: '#e6e6e6', snap: true },
      // 'geras' renderer + Classic theme give the bevelled, glossy 3D block
      // look (like ioBroker's Blockly editor) — the flatter 'thrasos'/'zelos'
      // renderers don't have the raised/3D edges.
      renderer: 'geras',
      theme: Blockly.Themes.Classic,
      // Serve Blockly's sprite/sound assets from our own static path — the
      // library's own default points at an external appspot.com URL, which
      // this app's Content-Security-Policy blocks.
      media: `${process.env.PUBLIC_URL || ''}/static/blockly-media/`,
    });
    workspaceRef.current = workspace;
    // Test-only hook (e.g. Playwright E2E checks) — harmless read/write
    // reference to the live workspace, namespaced to avoid collisions.
    window.__pbWorkspace = workspace;

    if (initialState) {
      Blockly.serialization.workspaces.load(initialState, workspace);
    }

    // Gives the parent a stable reference to call workspace.clear()/
    // serialization.load() on demand (e.g. the Section F sidecar loader),
    // independent of onChange which only fires on workspace edits.
    onWorkspaceReady?.(workspace);

    const listener = (event) => {
      if (event.isUiEvent) return;
      onChangeRef.current?.(workspace);
    };
    workspace.addChangeListener(listener);

    return () => {
      workspace.removeChangeListener(listener);
      workspace.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height: 500, width: '100%', ...style }}
    />
  );
}

export default BlocklyWorkspace;
