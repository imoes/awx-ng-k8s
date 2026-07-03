// awx-ng: thin React wrapper around Blockly.inject — no react-blockly dependency
// (avoids its React 18 peer-dependency requirement; this project is on React 17).
import React, { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';

function BlocklyWorkspace({ toolbox, initialState, onChange, onWorkspaceReady, height = 500, style }) {
  const containerRef = useRef(null);
  const workspaceRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const workspace = Blockly.inject(containerRef.current, {
      toolbox,
      trashcan: true,
      // Blockly's own wheel: true applies scaleSpeed^2 per wheel notch
      // (~1.44x) vs. scaleSpeed^1 (~1.2x) for one zoom-button click — wheel
      // steps felt twice as strong as a button click. Wheel zoom is handled
      // by our own gentler listener below instead (see onWheel).
      zoom: { controls: true, wheel: false, startScale: 1 },
      grid: { spacing: 24, length: 3, colour: '#e6e6e6', snap: true },
      // Category rubrics render as a horizontal navbar across the top of the
      // canvas (rather than a left-hand column).
      horizontalLayout: true,
      toolboxPosition: 'start',
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

    // Gentler wheel zoom (see the `zoom.wheel: false` note above): amount is
    // proportional to actual scroll delta rather than Blockly's fixed
    // per-notch amount, so both a single mouse-wheel notch (~±100) and a
    // trackpad's smaller continuous deltas feel proportionate — roughly half
    // of one zoom-button click per typical notch (scaleSpeed^0.5 ≈ 1.095 vs.
    // the button's scaleSpeed^1 = 1.2).
    const onWheel = (event) => {
      event.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const amount = -event.deltaY / 200;
      workspace.zoom(event.clientX - rect.left, event.clientY - rect.top, amount);
    };
    containerRef.current.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      workspace.removeChangeListener(listener);
      containerRef.current?.removeEventListener('wheel', onWheel);
      workspace.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', ...style }}
    />
  );
}

export default BlocklyWorkspace;
