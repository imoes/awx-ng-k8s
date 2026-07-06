/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder screen.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import {
  Alert,
  Button,
  Dropdown,
  DropdownItem,
  DropdownToggle,
  Modal,
  PageSection,
  Card,
  CardBody,
  SearchInput,
  Spinner,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { BarsIcon } from '@patternfly/react-icons';
import CodeEditor from 'components/CodeEditor';
import useRequest from 'hooks/useRequest';
import useTitle from 'hooks/useTitle';
import BlocklyWorkspace from './BlocklyWorkspace';
import { registerBlocks } from './blocks';
import { buildToolbox } from './toolbox';
import { serializeWorkspace } from './ansibleGenerator';
import { importPlaybookYaml, importTasksYaml, importVarsYaml } from './playbookImporter';
import { sidecarPathFor } from './sidecarPath';
import { insertVariableReference } from './varInsertion';
import VariablesPanel from './VariablesPanel';
import TemplatesPanel from './TemplatesPanel';
import {
  readProjects,
  readProjectRoles,
  readProjectPlays,
  readProjectFile,
  saveProjectFile,
  lintProjectFile,
} from '../api';

// YAML-holding fields (raw blocks + the play EXTRA/role VARS escape hatches).
// A dragged variable must NOT be dropped here — inserting a bare {{ name }}
// into a YAML field corrupts it (this was the reported char-spread bug).
const YAML_FIELD_NAMES = new Set(['EXTRA', 'RAW_YAML', 'VARS']);

// Finds the Blockly *value* text field under the given viewport coordinates
// (skipping YAML fields). Blockly has no built-in "field at point" API, but
// each field's SVG group is a real DOM node we can hit-test.
function findFieldAtPoint(workspace, clientX, clientY) {
  const blocks = workspace.getAllBlocks(false);
  for (let i = 0; i < blocks.length; i += 1) {
    const { inputList } = blocks[i];
    for (let j = 0; j < inputList.length; j += 1) {
      const { fieldRow } = inputList[j];
      for (let k = 0; k < fieldRow.length; k += 1) {
        const field = fieldRow[k];
        if (!(field instanceof Blockly.FieldTextInput)) continue;
        if (YAML_FIELD_NAMES.has(field.name)) continue;
        const svgRoot = field.getSvgRoot ? field.getSvgRoot() : null;
        if (!svgRoot) continue;
        const rect = svgRoot.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return field;
        }
      }
    }
  }
  return null;
}

// A role's 4 editable sections (in tab order) — each maps 1:1 to a real
// role subdirectory (roles/<name>/<section>/main.yml). tasks/handlers share
// the "bare task list" shape; defaults/vars share the "bare vars mapping"
// shape (see ansibleGenerator.js serializeWorkspace()).
const ROLE_SECTIONS = ['tasks', 'handlers', 'defaults', 'vars'];
// Tab bar order: the 4 Blockly sections, plus the non-Blockly Templates tab
// (roles/<name>/templates/*.j2 — see TemplatesPanel.js for why it isn't a
// 5th ROLE_SECTIONS entry: unlike the other 4, it's not one fixed-name file).
const ROLE_TABS = [...ROLE_SECTIONS, 'templates'];
const ROLE_SECTION_LABELS = {
  tasks: 'Tasks', handlers: 'Handlers', defaults: 'Defaults', vars: 'Vars', templates: 'Templates',
};

function sectionSerializeMode(section) {
  return section === 'defaults' || section === 'vars' ? 'vars' : 'tasks';
}

function roleSectionPath(roleName, section) {
  return `roles/${roleName}/${section}/main.yml`;
}

// What an untouched/never-visited section should write as its stub file —
// generated from a real (empty) workspace rather than a hand-written string
// so it's always exactly what serializeWorkspace would produce.
function emptyStubYaml(mode) {
  const tmp = new Blockly.Workspace();
  const text = serializeWorkspace(tmp, mode);
  tmp.dispose();
  return text;
}

// Variables defined ON THE CURRENT CANVAS — a play's `vars:` chain, or (in
// role mode) the Defaults/Vars tab's top-level define_var chain. Fed into
// VariablesPanel so a variable just created there shows up immediately,
// without waiting for a save + role/vault re-fetch.
function extractCanvasVars(ws, docMode, section) {
  const entries = [];
  const collectChain = (block) => {
    let b = block;
    while (b) {
      if (b.type === 'define_var' && b.isEnabled()) {
        const name = b.getFieldValue('NAME');
        if (name) entries.push({ name, value: b.getFieldValue('VALUE') });
      }
      b = b.getNextBlock();
    }
  };
  if (docMode === 'playbook') {
    const play = ws.getTopBlocks(true).find((b) => b.type === 'play');
    if (play) collectChain(play.getInputTargetBlock('VARS'));
  } else if (sectionSerializeMode(section) === 'vars') {
    ws.getTopBlocks(true).forEach((top) => { if (top.type === 'define_var') collectChain(top); });
  }
  return entries;
}

function workspaceRoleNames(workspace) {
  return workspace
    .getAllBlocks(false)
    .filter((b) => b.type === 'role_use')
    .map((b) => b.getFieldValue('ROLE_NAME'))
    .filter(Boolean);
}

function PlaybookBuilder() {
  // Sets the browser tab title without rendering the (breadcrumb + big h2)
  // ScreenHeader bar — that bar was pure overhead here (single-crumb route,
  // collapses to just a heading) and pushed the canvas down; every other
  // pixel matters for the workbench (user feedback).
  useTitle('Playbook Builder');
  const [blockCount, setBlockCount] = useState(0);
  const [playbookYaml, setPlaybookYaml] = useState('---\n');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [docMode, setDocMode] = useState('playbook'); // 'playbook' | 'role'
  const [openedRole, setOpenedRole] = useState(null);
  const [targetPath, setTargetPath] = useState('playbooks/blockly-test.yml');
  // Role mode only: which of the 4 sections (tasks/handlers/defaults/vars)
  // is currently shown on the canvas, and the role's name (all 4 file paths
  // are derived from it — see roleSectionPath()).
  const [roleSection, setRoleSection] = useState('tasks');
  const [roleName, setRoleName] = useState('new-role');
  const [relevantRoles, setRelevantRoles] = useState([]);
  // Variables defined ON THE CURRENT CANVAS (a play's vars: chain, or a
  // role's Defaults/Vars tab) — fed into VariablesPanel so a var just
  // created there shows up immediately, tagged "this document".
  const [docVars, setDocVars] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [lintErrors, setLintErrors] = useState([]);
  const [saved, setSaved] = useState(false);
  const [loadMessage, setLoadMessage] = useState(null);

  // Transient success confirmations ("Saved to …", "Opened role …") are
  // pure feedback, not something the user needs to act on — auto-dismiss
  // them so they don't permanently eat vertical space (user feedback: every
  // pixel matters here). Errors/warnings (saveError, a danger loadMessage,
  // lintErrors) stay until the user resolves them or takes another action.
  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);
  useEffect(() => {
    if (!loadMessage || loadMessage.variant !== 'success') return undefined;
    const timer = setTimeout(() => setLoadMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [loadMessage]);

  // Open-dialog state
  const [openDialog, setOpenDialog] = useState(false);
  const [openKind, setOpenKind] = useState('playbook'); // 'playbook' | 'role'
  const [playbookOptions, setPlaybookOptions] = useState([]);
  const [roleOptions, setRoleOptions] = useState([]);
  const [openSearch, setOpenSearch] = useState('');
  const [opening, setOpening] = useState(false);

  // Hamburger (file actions) menu open state.
  const [menuOpen, setMenuOpen] = useState(false);

  const workspaceRef = useRef(null);
  // Refs so the (stable) change/drop handlers always see the latest mode.
  const docModeRef = useRef(docMode);
  docModeRef.current = docMode;
  const openedRoleRef = useRef(openedRole);
  openedRoleRef.current = openedRole;
  const roleSectionRef = useRef(roleSection);
  roleSectionRef.current = roleSection;
  // Cache of the 3 role sections NOT currently on the canvas, keyed by
  // section name: { blockly: <serialized workspace state>, yaml: <string> }.
  // Populated on tab-switch (outgoing section) and on role-open (all 4 at
  // once). Never triggers a re-render itself — it's a plain mutable cache.
  const roleSectionsRef = useRef({});

  // The 3-column canvas/YAML/variables row is sized to exactly fill the
  // remaining viewport height below it, so only THOSE columns scroll
  // internally — never the whole page. Recomputed on resize and whenever
  // something above the row (alerts, role tabs) could change its own
  // height, which would otherwise push the row past the viewport bottom.
  const builderRowRef = useRef(null);
  const [builderRowHeight, setBuilderRowHeight] = useState(480);
  useLayoutEffect(() => {
    const updateHeight = () => {
      const el = builderRowRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setBuilderRowHeight(Math.max(360, window.innerHeight - top - 24));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [docMode, roleSection, saveError, saved, loadMessage, lintErrors.length]);

  const toolbox = useMemo(() => {
    registerBlocks();
    return buildToolbox([]);
  }, []);

  // Stable — reads refs, so it never needs to be recreated and can be used
  // by the workspace change listener and the document drop listener alike.
  const refreshFromWorkspace = useCallback((ws) => {
    setBlockCount(ws.getAllBlocks(false).length);
    const mode = docModeRef.current === 'role'
      ? sectionSerializeMode(roleSectionRef.current)
      : 'playbook';
    setPlaybookYaml(serializeWorkspace(ws, mode));
    const roles = workspaceRoleNames(ws);
    if (openedRoleRef.current) roles.push(openedRoleRef.current);
    setRelevantRoles(roles);
    setDocVars(extractCanvasVars(ws, docModeRef.current, roleSectionRef.current));
  }, []);

  const { request: loadProjects } = useRequest(
    useCallback(async () => {
      const { data } = await readProjects({ page_size: 200, order_by: 'name' });
      setProjects(data.results || []);
      if (data.results?.length) setProjectId(String(data.results[0].id));
    }, [])
  );
  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Per-project role list drives both the toolbox's Roles category and the
  // Open dialog's role picker. The Roles category is static content (needed
  // for @blockly/toolbox-search to index it), so the whole toolbox is
  // rebuilt via updateToolbox() whenever the role list changes.
  const { request: loadRoles } = useRequest(
    useCallback(async () => {
      if (!projectId) return;
      const { data } = await readProjectRoles(projectId);
      const names = (data.results || []).map((r) => r.role_name);
      setRoleOptions(names);
      workspaceRef.current?.updateToolbox(buildToolbox(names));
    }, [projectId])
  );
  useEffect(() => { loadRoles(); }, [loadRoles]);

  // Wire document-level drag/drop once. Capture phase so it also intercepts
  // drops onto Blockly's open inline HTML input (which would otherwise paste
  // the raw variable name without the {{ }} wrapper).
  useEffect(() => {
    // Templates tab has no live Blockly canvas (see ROLE_TABS/TemplatesPanel)
    // — workspaceRef.current still points at the LAST Blockly instance
    // (BlocklyWorkspace disposes it on unmount but nothing nulls the ref),
    // so this guard is required, not just an optimization. TemplatesPanel
    // handles its own variable-drop locally (drop straight into Monaco).
    const isTemplatesTab = () => docModeRef.current === 'role' && roleSectionRef.current === 'templates';
    const onDragOver = (event) => {
      if (isTemplatesTab()) return;
      const ws = workspaceRef.current;
      if (!ws) return;
      if (findFieldAtPoint(ws, event.clientX, event.clientY)) {
        event.preventDefault();
        return;
      }
      const injectionDiv = ws.getInjectionDiv ? ws.getInjectionDiv() : null;
      if (injectionDiv && injectionDiv.contains(event.target)) {
        event.preventDefault();
      }
    };
    const onDrop = (event) => {
      if (isTemplatesTab()) return;
      const ws = workspaceRef.current;
      if (!ws) return;
      const varName = event.dataTransfer?.getData('text/plain');
      if (!varName) return;
      const field = findFieldAtPoint(ws, event.clientX, event.clientY);
      if (field) {
        event.preventDefault();
        event.stopPropagation();
        // Close any open inline editor so our value isn't overwritten on blur.
        try { Blockly.WidgetDiv.hide(); } catch { /* no editor open */ }
        insertVariableReference(field, varName);
        refreshFromWorkspace(ws);
        return;
      }
      // Not over a field — if the drop lands on the Blockly canvas itself,
      // spawn a cond_var block there instead (the "variable as a Blockly
      // element" workflow: drag a variable out onto empty canvas to get a
      // block usable in a when: condition, not just text-field insertion).
      const injectionDiv = ws.getInjectionDiv ? ws.getInjectionDiv() : null;
      if (!injectionDiv || !injectionDiv.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const block = ws.newBlock('cond_var');
      block.setFieldValue(varName, 'NAME');
      block.initSvg();
      block.render();
      const wsCoord = Blockly.utils.svgMath.screenToWsCoordinates(
        ws,
        new Blockly.utils.Coordinate(event.clientX, event.clientY)
      );
      block.moveBy(wsCoord.x, wsCoord.y);
      // If the drop lands right on (or near) an open value socket — a
      // dict_entry's/list_item's/define_var's "or" input, or a dict-/list-
      // typed module param's BLOCK_<name> input — snap straight into it
      // instead of leaving the block loose on the canvas. Reuses Blockly's
      // own connection search/checker (the same one a manual drag-to-connect
      // uses), so it only snaps into checks-compatible, still-open sockets.
      const { connection: target } = block.outputConnection.closest(
        Blockly.config.connectingSnapRadius,
        new Blockly.utils.Coordinate(0, 0)
      );
      if (target && !target.isConnected()) target.connect(block.outputConnection);
      refreshFromWorkspace(ws);
    };
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
    };
  }, [refreshFromWorkspace]);

  const handleWorkspaceReady = (ws) => {
    workspaceRef.current = ws;
  };

  const handleNew = (mode) => {
    const ws = workspaceRef.current;
    if (!ws) return;
    ws.clear();
    if (mode === 'playbook') {
      const seed = ws.newBlock('play');
      seed.initSvg();
      seed.render();
      seed.moveBy(30, 30);
    }
    // Role mode has no wrapper block to seed — drag a module block from the
    // Modules category directly onto the canvas to start the first task.
    // All 4 sections start empty; Save scaffolds all 4 files/directories
    // even for sections the user never visits (see handleSave).
    setDocMode(mode);
    docModeRef.current = mode;
    setOpenedRole(null);
    openedRoleRef.current = null;
    if (mode === 'role') {
      roleSectionsRef.current = {};
      setRoleName('new-role');
      setRoleSection('tasks');
      roleSectionRef.current = 'tasks';
    } else {
      setTargetPath('playbooks/new-playbook.yml');
    }
    setLoadMessage(null);
    setLintErrors([]);
    setSaved(false);
    refreshFromWorkspace(ws);
  };

  // Switches the active role tab (Tasks/Handlers/Defaults/Vars/Templates),
  // caching the outgoing section's Blockly state first so nothing is lost.
  // The 4 Blockly sections share one workspace instance, swapped in and out;
  // Templates has no Blockly workspace at all (see ROLE_TABS/TemplatesPanel)
  // — switching to/from it just hides/shows the canvas, no save/load here.
  const switchRoleSection = (nextSection) => {
    if (nextSection === roleSection) return;
    const ws = workspaceRef.current;
    if (ws && roleSection !== 'templates') {
      roleSectionsRef.current[roleSection] = {
        blockly: Blockly.serialization.workspaces.save(ws),
        yaml: serializeWorkspace(ws, sectionSerializeMode(roleSection)),
      };
    }
    if (ws && nextSection !== 'templates') {
      ws.clear();
      const cached = roleSectionsRef.current[nextSection];
      if (cached?.blockly) {
        Blockly.serialization.workspaces.load(cached.blockly, ws);
      }
    }
    setRoleSection(nextSection);
    roleSectionRef.current = nextSection;
    if (ws && nextSection !== 'templates') refreshFromWorkspace(ws);
  };

  // Creates a new define_var block from the Variables panel's "+ Add
  // variable" form and chains it into the right place for the current
  // document: a play's vars: stack, or (role mode) the active Defaults/Vars
  // tab's top-level chain. Only offered when that makes sense — see
  // canCreateVariable below (hidden on the Tasks/Handlers tabs, which
  // aren't vars-shaped documents).
  const handleCreateVariable = (name, value) => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const varBlock = ws.newBlock('define_var');
    varBlock.setFieldValue(name, 'NAME');
    varBlock.setFieldValue(value, 'VALUE');
    if (typeof varBlock.initSvg === 'function') { varBlock.initSvg(); varBlock.render(); }

    if (docMode === 'playbook') {
      const play = ws.getTopBlocks(true).find((b) => b.type === 'play');
      if (play) {
        const varsInput = play.getInput('VARS');
        let last = varsInput.connection.targetBlock();
        if (!last) {
          varsInput.connection.connect(varBlock.previousConnection);
        } else {
          while (last.getNextBlock()) last = last.getNextBlock();
          last.nextConnection.connect(varBlock.previousConnection);
        }
      } else {
        varBlock.moveBy(20, 20);
      }
    } else {
      // Role mode, Defaults/Vars tab — chain onto the existing top-level
      // define_var stack, or just place it if this is the first one.
      let last = ws.getTopBlocks(true).find((b) => b.type === 'define_var');
      if (last) {
        while (last.getNextBlock()) last = last.getNextBlock();
        last.nextConnection.connect(varBlock.previousConnection);
      } else {
        varBlock.moveBy(20, 20);
      }
    }
    refreshFromWorkspace(ws);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setLintErrors([]);
    setSaved(false);
    try {
      if (docMode === 'role') {
        const ok = await saveRoleSections();
        if (!ok) return;
      } else {
        const { data: lintResult } = await lintProjectFile(projectId, playbookYaml, targetPath);
        if (!lintResult.valid) {
          setLintErrors(lintResult.errors || []);
          return;
        }
        await saveProjectFile(projectId, targetPath, playbookYaml);
        // Persist the visual layout alongside the generated YAML so the
        // builder can be reopened later without losing the block arrangement.
        const workspaceState = Blockly.serialization.workspaces.save(workspaceRef.current);
        await saveProjectFile(projectId, sidecarPathFor(targetPath), JSON.stringify(workspaceState));
      }
      setSaved(true);
    } catch (e) {
      setSaveError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  // Writes all 4 role sections at once (roles/<name>/{tasks,handlers,
  // defaults,vars}/main.yml), scaffolding directories/files the user never
  // even opened as empty stubs — "the user shouldn't have to deal with it".
  // Only the currently-active section is linted (matches the single-file
  // lint UX elsewhere); the other 3 are trusted from when they were active.
  // Returns false (and sets lintErrors) on a lint failure, true on success —
  // callers must check this since it can't just early-return out of the
  // caller's own try block the way a plain inline lint check would.
  const saveRoleSections = async () => {
    const ws = workspaceRef.current;
    const activeYaml = serializeWorkspace(ws, sectionSerializeMode(roleSection));
    roleSectionsRef.current[roleSection] = {
      blockly: Blockly.serialization.workspaces.save(ws),
      yaml: activeYaml,
    };

    const activePath = roleSectionPath(roleName, roleSection);
    const { data: lintResult } = await lintProjectFile(projectId, activeYaml, activePath);
    if (!lintResult.valid) {
      setLintErrors(lintResult.errors || []);
      return false;
    }

    await Promise.all(ROLE_SECTIONS.map(async (section) => {
      const cached = roleSectionsRef.current[section];
      const path = roleSectionPath(roleName, section);
      const yamlText = cached ? cached.yaml : emptyStubYaml(sectionSerializeMode(section));
      await saveProjectFile(projectId, path, yamlText);
      if (cached) {
        await saveProjectFile(projectId, sidecarPathFor(path), JSON.stringify(cached.blockly));
      }
    }));
    return true;
  };

  // ── Open dialog ──────────────────────────────────────────────────────────
  const openBrowseDialog = async (kind) => {
    setOpenKind(kind);
    setOpenSearch('');
    setOpenDialog(true);
    if (kind === 'playbook' && playbookOptions.length === 0) {
      try {
        const { data } = await readProjectPlays(projectId);
        setPlaybookOptions((data.results || []).map((p) => p.playbook));
      } catch { /* leave empty; dialog shows "none" */ }
    }
  };

  const openDocument = async (path) => {
    setOpening(true);
    setLoadMessage(null);
    setSaveError(null);
    try {
      const ws = workspaceRef.current;
      // Prefer a saved Blockly layout sidecar (exact block arrangement);
      // fall back to parsing the YAML itself if there's no sidecar.
      let restoredFromSidecar = false;
      try {
        const sidecar = await readProjectFile(projectId, sidecarPathFor(path));
        ws.clear();
        Blockly.serialization.workspaces.load(JSON.parse(sidecar.data.content), ws);
        restoredFromSidecar = true;
      } catch { /* no sidecar — import from YAML below */ }

      if (!restoredFromSidecar) {
        const { data } = await readProjectFile(projectId, path);
        importPlaybookYaml(data.content, ws);
      }

      setDocMode('playbook');
      docModeRef.current = 'playbook';
      setOpenedRole(null);
      openedRoleRef.current = null;
      setTargetPath(path);
      refreshFromWorkspace(ws);
      setOpenDialog(false);
      setLoadMessage({
        variant: 'success',
        text: `Opened ${path}${restoredFromSidecar ? ' (from saved layout)' : ''}.`,
      });
    } catch (e) {
      setLoadMessage({ variant: 'danger', text: e?.response?.data?.detail || e.message });
    } finally {
      setOpening(false);
    }
  };

  // Loads all 4 sections of an existing role up front (so switching tabs is
  // instant, no extra round-trip), rendering "Tasks" on the canvas first.
  // A section whose file doesn't exist yet (role predates this feature, or
  // that section was simply never populated) is just treated as empty.
  const openRoleDocument = async (name) => {
    setOpening(true);
    setLoadMessage(null);
    setSaveError(null);
    try {
      const cache = {};
      await Promise.all(ROLE_SECTIONS.map(async (section) => {
        const path = roleSectionPath(name, section);
        try {
          const sidecar = await readProjectFile(projectId, sidecarPathFor(path));
          cache[section] = { blockly: JSON.parse(sidecar.data.content), yaml: null };
          return;
        } catch { /* no sidecar — import from YAML below */ }
        try {
          const { data } = await readProjectFile(projectId, path);
          const tmp = new Blockly.Workspace();
          if (sectionSerializeMode(section) === 'vars') importVarsYaml(data.content, tmp);
          else importTasksYaml(data.content, tmp);
          cache[section] = { blockly: Blockly.serialization.workspaces.save(tmp), yaml: data.content };
          tmp.dispose();
        } catch {
          cache[section] = null; // file doesn't exist yet — treated as empty
        }
      }));
      roleSectionsRef.current = cache;

      const ws = workspaceRef.current;
      ws.clear();
      if (cache.tasks?.blockly) Blockly.serialization.workspaces.load(cache.tasks.blockly, ws);

      setDocMode('role');
      docModeRef.current = 'role';
      setRoleName(name);
      setRoleSection('tasks');
      roleSectionRef.current = 'tasks';
      setOpenedRole(name);
      openedRoleRef.current = name;
      refreshFromWorkspace(ws);
      setOpenDialog(false);
      setLoadMessage({ variant: 'success', text: `Opened role ${name}.` });
    } catch (e) {
      setLoadMessage({ variant: 'danger', text: e?.response?.data?.detail || e.message });
    } finally {
      setOpening(false);
    }
  };

  const openList = openKind === 'playbook'
    ? playbookOptions.map((p) => ({ path: p, label: p, mode: 'playbook' }))
    : roleOptions.map((r) => ({ path: `roles/${r}/tasks/main.yml`, label: r, mode: 'role', role: r }));
  const filteredOpenList = openList.filter(
    (o) => !openSearch || o.label.toLowerCase().includes(openSearch.toLowerCase())
  );

  return (
    <>
      <PageSection style={{ paddingTop: 8, paddingBottom: 8 }}>
        <Card>
          <CardBody style={{ paddingTop: 12, paddingBottom: 12 }}>
            {/* Single compact toolbar row — no stacked FormGroup labels (each
                one cost an extra text line of height); inline labels instead.
                Rarely-used actions (new/open) live in the File hamburger so
                this row stays one line and leaves room for the canvas below. */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Dropdown
                data-testid="pb-file-menu"
                isOpen={menuOpen}
                toggle={
                  <DropdownToggle
                    id="pb-file-menu-toggle"
                    data-testid="pb-file-menu-toggle"
                    toggleIndicator={null}
                    onToggle={(_e, val) => setMenuOpen(typeof val === 'boolean' ? val : !menuOpen)}
                    aria-label="File actions menu"
                  >
                    <BarsIcon />
                  </DropdownToggle>
                }
                dropdownItems={[
                  <DropdownItem key="new-pb" data-testid="pb-new-playbook-button" onClick={() => { setMenuOpen(false); handleNew('playbook'); }}>
                    New playbook
                  </DropdownItem>,
                  <DropdownItem key="new-role" data-testid="pb-new-role-button" onClick={() => { setMenuOpen(false); handleNew('role'); }}>
                    New role
                  </DropdownItem>,
                  <DropdownItem key="open-pb" data-testid="pb-open-playbook-button" isDisabled={!projectId} onClick={() => { setMenuOpen(false); openBrowseDialog('playbook'); }}>
                    Open playbook…
                  </DropdownItem>,
                  <DropdownItem key="open-role" data-testid="pb-open-role-button" isDisabled={!projectId} onClick={() => { setMenuOpen(false); openBrowseDialog('role'); }}>
                    Open role…
                  </DropdownItem>,
                ]}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label htmlFor="pb-project-select" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Project</label>
                <select
                  id="pb-project-select"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  style={{ padding: '4px 6px', border: '1px solid #ddd', borderRadius: 4, maxWidth: 180 }}
                  data-testid="pb-project-select"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {docMode === 'role' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 260px', minWidth: 180 }}>
                  <label htmlFor="pb-role-name" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Role name</label>
                  <TextInput
                    id="pb-role-name"
                    aria-label="Role name"
                    value={roleName}
                    onChange={setRoleName}
                    data-testid="pb-role-name"
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 260px', minWidth: 180 }}>
                  <label htmlFor="pb-target-path" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Save to</label>
                  <TextInput
                    id="pb-target-path"
                    aria-label="Save to path"
                    value={targetPath}
                    onChange={setTargetPath}
                    data-testid="pb-target-path"
                  />
                </div>
              )}
              <Button
                variant="primary"
                onClick={handleSave}
                isDisabled={saving || !projectId}
                data-testid="pb-save-button"
              >
                {saving ? <Spinner size="sm" /> : 'Lint & Save'}
              </Button>
            </div>

            {docMode === 'role' && (
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }} data-testid="pb-role-section-tabs">
                {ROLE_TABS.map((section) => (
                  <button
                    key={section}
                    type="button"
                    data-testid={`pb-role-section-${section}`}
                    onClick={() => switchRoleSection(section)}
                    style={{
                      padding: '3px 12px',
                      fontSize: 13,
                      border: '1px solid #ccc',
                      borderBottom: section === roleSection ? '2px solid #06c' : '1px solid #ccc',
                      borderRadius: '4px 4px 0 0',
                      background: section === roleSection ? '#fff' : '#f2f2f2',
                      fontWeight: section === roleSection ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {ROLE_SECTION_LABELS[section]}
                  </button>
                ))}
              </div>
            )}

            {saveError && <Alert variant="danger" title={saveError} isInline style={{ marginBottom: 8 }} />}
            {saved && (
              <Alert
                variant="success"
                title={docMode === 'role' ? `Saved role ${roleName} (tasks/handlers/defaults/vars)` : `Saved to ${targetPath}`}
                isInline
                style={{ marginBottom: 8 }}
              />
            )}
            {loadMessage && (
              <Alert
                variant={loadMessage.variant}
                title={loadMessage.text}
                isInline
                style={{ marginBottom: 8 }}
                data-testid="pb-load-message"
              />
            )}
            {lintErrors.length > 0 && (
              <Alert variant="warning" title="Lint issues — not saved" isInline style={{ marginBottom: 8 }}>
                <ul data-testid="pb-lint-errors">
                  {lintErrors.map((err) => (
                    <li key={`${err.line}-${err.message}`}>
                      Line {err.line}: {err.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            <div data-testid="blockly-block-count" style={{ display: 'none' }}>{blockCount}</div>
            <div
              ref={builderRowRef}
              style={{ display: 'flex', gap: 16, height: builderRowHeight }}
            >
              {docMode === 'role' && roleSection === 'templates' ? (
                <div style={{ flex: '1 1 auto', minWidth: 0, height: '100%' }} data-testid="pb-templates-panel">
                  <TemplatesPanel projectId={projectId} roleName={roleName} />
                </div>
              ) : (
                <div style={{ flex: '1 1 auto', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ flex: '1 1 60%', minHeight: 0, overflow: 'hidden' }}>
                    <BlocklyWorkspace
                      toolbox={toolbox}
                      height="100%"
                      onChange={refreshFromWorkspace}
                      onWorkspaceReady={handleWorkspaceReady}
                    />
                  </div>
                  <div style={{ flex: '1 1 40%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <Title headingLevel="h3" size="sm" style={{ marginBottom: 8, flex: '0 0 auto' }}>
                      {docMode === 'role' ? `Generated YAML — ${ROLE_SECTION_LABELS[roleSection]}` : 'Generated YAML'}
                    </Title>
                    <div data-testid="playbook-yaml-preview" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
                      <CodeEditor value={playbookYaml} mode="yaml" readOnly rows="auto" />
                    </div>
                  </div>
                </div>
              )}
              {/* Variables column stays visible on every tab, including
                  Templates — a Jinja2 template is exactly where you'd want
                  to look up/drag a {{ variable }} name (see VariablesPanel's
                  onDragStart + TemplatesPanel's own drop handler). Creating
                  a NEW variable only makes sense on a vars-shaped document. */}
              <div style={{ flex: '0 0 150px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Title headingLevel="h3" size="sm" style={{ marginBottom: 8, flex: '0 0 auto' }}>
                  Variables
                </Title>
                <VariablesPanel
                  projectId={projectId}
                  roleNames={relevantRoles}
                  localVars={docVars.map((v) => ({ name: v.name, source: 'this document', preview: v.value }))}
                  onCreateVariable={
                    docMode === 'playbook' || (roleSection !== 'templates' && sectionSerializeMode(roleSection) === 'vars')
                      ? handleCreateVariable
                      : undefined
                  }
                />
              </div>
            </div>
          </CardBody>
        </Card>
      </PageSection>

      <Modal
        title={openKind === 'playbook' ? 'Open playbook' : 'Open role'}
        isOpen={openDialog}
        variant="small"
        onClose={() => setOpenDialog(false)}
        actions={[
          <Button key="cancel" variant="link" onClick={() => setOpenDialog(false)}>
            Cancel
          </Button>,
        ]}
      >
        <SearchInput
          placeholder={openKind === 'playbook' ? 'Filter playbooks…' : 'Filter roles…'}
          value={openSearch}
          onChange={(_e, v) => setOpenSearch(v)}
          onClear={() => setOpenSearch('')}
          style={{ marginBottom: 12 }}
        />
        {opening && <Spinner size="md" />}
        <div style={{ maxHeight: 360, overflowY: 'auto' }} data-testid="pb-open-list">
          {filteredOpenList.length === 0 && (
            <p style={{ color: '#888', fontSize: 13 }}>
              {openKind === 'playbook' ? 'No playbooks found in this project.' : 'No roles found in this project.'}
            </p>
          )}
          {filteredOpenList.map((o) => (
            <button
              type="button"
              key={o.path}
              data-testid="pb-open-item"
              data-openpath={o.path}
              onClick={() => (o.mode === 'role' ? openRoleDocument(o.role) : openDocument(o.path))}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 10px', marginBottom: 4, border: '1px solid #eee',
                borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

export default PlaybookBuilder;
