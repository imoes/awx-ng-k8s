/* eslint-disable i18next/no-literal-string */
// awx-ng: Visual (Blockly) playbook builder screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import {
  Alert,
  Button,
  Dropdown,
  DropdownItem,
  DropdownToggle,
  FormGroup,
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
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import CodeEditor from 'components/CodeEditor';
import useRequest from 'hooks/useRequest';
import BlocklyWorkspace from './BlocklyWorkspace';
import { registerBlocks } from './blocks';
import { buildToolbox, registerCategoryCallbacks } from './toolbox';
import { serializeWorkspace } from './ansibleGenerator';
import { importPlaybookYaml, importTasksYaml } from './playbookImporter';
import { sidecarPathFor } from './sidecarPath';
import { insertVariableReference } from './varInsertion';
import VariablesPanel from './VariablesPanel';
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

function workspaceRoleNames(workspace) {
  return workspace
    .getAllBlocks(false)
    .filter((b) => b.type === 'role_use')
    .map((b) => b.getFieldValue('ROLE_NAME'))
    .filter(Boolean);
}

function PlaybookBuilder() {
  const [blockCount, setBlockCount] = useState(0);
  const [playbookYaml, setPlaybookYaml] = useState('---\n');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [docMode, setDocMode] = useState('playbook'); // 'playbook' | 'role'
  const [openedRole, setOpenedRole] = useState(null);
  const [targetPath, setTargetPath] = useState('playbooks/blockly-test.yml');
  const [relevantRoles, setRelevantRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [lintErrors, setLintErrors] = useState([]);
  const [saved, setSaved] = useState(false);
  const [loadMessage, setLoadMessage] = useState(null);

  // Open-dialog state
  const [openDialog, setOpenDialog] = useState(false);
  const [openKind, setOpenKind] = useState('playbook'); // 'playbook' | 'role'
  const [playbookOptions, setPlaybookOptions] = useState([]);
  const [roleOptions, setRoleOptions] = useState([]);
  const [openSearch, setOpenSearch] = useState('');
  const [opening, setOpening] = useState(false);

  // Live palette filter — narrows whichever dynamic category (Modules or
  // Roles) is currently open. Only one is ever open, so it scopes per rubric.
  const [paletteFilter, setPaletteFilter] = useState('');
  // Hamburger (file actions) menu open state.
  const [menuOpen, setMenuOpen] = useState(false);

  const workspaceRef = useRef(null);
  // Refs so the (stable) change/drop handlers always see the latest mode.
  const docModeRef = useRef(docMode);
  docModeRef.current = docMode;
  const openedRoleRef = useRef(openedRole);
  openedRoleRef.current = openedRole;
  // Read live by the dynamic-category callbacks (registered once).
  const paletteFilterRef = useRef('');
  const roleNamesRef = useRef([]);

  const toolbox = useMemo(() => {
    registerBlocks();
    return buildToolbox();
  }, []);

  // Stable — reads refs, so it never needs to be recreated and can be used
  // by the workspace change listener and the document drop listener alike.
  const refreshFromWorkspace = useCallback((ws) => {
    setBlockCount(ws.getAllBlocks(false).length);
    setPlaybookYaml(serializeWorkspace(ws, docModeRef.current));
    const roles = workspaceRoleNames(ws);
    if (openedRoleRef.current) roles.push(openedRoleRef.current);
    setRelevantRoles(roles);
  }, []);

  const { request: loadProjects } = useRequest(
    useCallback(async () => {
      const { data } = await readProjects({ page_size: 200, order_by: 'name' });
      setProjects(data.results || []);
      if (data.results?.length) setProjectId(String(data.results[0].id));
    }, [])
  );
  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Per-project role list drives both the Roles category (via roleNamesRef,
  // read by the dynamic-category callback) and the Open dialog's role picker.
  const { request: loadRoles } = useRequest(
    useCallback(async () => {
      if (!projectId) return;
      const { data } = await readProjectRoles(projectId);
      const names = (data.results || []).map((r) => r.role_name);
      setRoleOptions(names);
      roleNamesRef.current = names;
      // Re-render the Roles flyout if it's the one currently open.
      workspaceRef.current?.getToolbox()?.refreshSelection();
    }, [projectId])
  );
  useEffect(() => { loadRoles(); }, [loadRoles]);

  const handlePaletteFilter = (value) => {
    setPaletteFilter(value);
    paletteFilterRef.current = value;
    // Re-run the open category's custom callback with the new filter.
    workspaceRef.current?.getToolbox()?.refreshSelection();
  };

  // Wire document-level drag/drop once. Capture phase so it also intercepts
  // drops onto Blockly's open inline HTML input (which would otherwise paste
  // the raw variable name without the {{ }} wrapper).
  useEffect(() => {
    const onDragOver = (event) => {
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
    // Register the dynamic Modules/Roles category callbacks; they read the
    // live palette filter + project role names via refs.
    registerCategoryCallbacks(ws, {
      getFilter: () => paletteFilterRef.current,
      getRoleNames: () => roleNamesRef.current,
    });
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
    setDocMode(mode);
    docModeRef.current = mode;
    setOpenedRole(null);
    openedRoleRef.current = null;
    setTargetPath(mode === 'role' ? 'roles/new-role/tasks/main.yml' : 'playbooks/new-playbook.yml');
    setLoadMessage(null);
    setLintErrors([]);
    setSaved(false);
    refreshFromWorkspace(ws);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setLintErrors([]);
    setSaved(false);
    try {
      const { data: lintResult } = await lintProjectFile(projectId, playbookYaml, targetPath);
      if (!lintResult.valid) {
        setLintErrors(lintResult.errors || []);
        return;
      }
      await saveProjectFile(projectId, targetPath, playbookYaml);
      // Persist the visual layout alongside the generated YAML so the builder
      // can be reopened later without losing the block arrangement.
      const workspaceState = Blockly.serialization.workspaces.save(workspaceRef.current);
      await saveProjectFile(projectId, sidecarPathFor(targetPath), JSON.stringify(workspaceState));
      setSaved(true);
    } catch (e) {
      setSaveError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
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

  const openDocument = async (path, mode, roleName) => {
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
        if (mode === 'role') importTasksYaml(data.content, ws);
        else importPlaybookYaml(data.content, ws);
      }

      setDocMode(mode);
      docModeRef.current = mode;
      setOpenedRole(mode === 'role' ? roleName : null);
      openedRoleRef.current = mode === 'role' ? roleName : null;
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

  const openList = openKind === 'playbook'
    ? playbookOptions.map((p) => ({ path: p, label: p, mode: 'playbook' }))
    : roleOptions.map((r) => ({ path: `roles/${r}/tasks/main.yml`, label: r, mode: 'role', role: r }));
  const filteredOpenList = openList.filter(
    (o) => !openSearch || o.label.toLowerCase().includes(openSearch.toLowerCase())
  );

  return (
    <>
      <ScreenHeader
        streamType="playbook_builder"
        breadcrumbConfig={{ '/playbook-builder': 'Playbook Builder' }}
        title="Playbook Builder"
      />
      <PageSection>
        <Card>
          <CardBody>
            <Title headingLevel="h2" size="md" style={{ marginBottom: 12 }}>
              Playbook Builder
            </Title>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <FormGroup label="File" fieldId="pb-file-menu">
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
              </FormGroup>
              <FormGroup label="Project" style={{ minWidth: 200 }}>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4 }}
                  data-testid="pb-project-select"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </FormGroup>
              <FormGroup label={docMode === 'role' ? 'Role file' : 'Save to'} style={{ minWidth: 320 }}>
                <TextInput
                  value={targetPath}
                  onChange={setTargetPath}
                  data-testid="pb-target-path"
                />
              </FormGroup>
              <Button
                variant="primary"
                onClick={handleSave}
                isDisabled={saving || !projectId}
                data-testid="pb-save-button"
              >
                {saving ? <Spinner size="sm" /> : 'Lint & Save'}
              </Button>
            </div>

            {saveError && <Alert variant="danger" title={saveError} isInline style={{ marginBottom: 12 }} />}
            {saved && <Alert variant="success" title={`Saved to ${targetPath}`} isInline style={{ marginBottom: 12 }} />}
            {loadMessage && (
              <Alert
                variant={loadMessage.variant}
                title={loadMessage.text}
                isInline
                style={{ marginBottom: 12 }}
                data-testid="pb-load-message"
              />
            )}
            {lintErrors.length > 0 && (
              <Alert variant="warning" title="Lint issues — not saved" isInline style={{ marginBottom: 12 }}>
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
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: '1 1 58%', minWidth: 0 }}>
                <div style={{ marginBottom: 8, maxWidth: 320 }}>
                  <SearchInput
                    placeholder="Filter open category (Modules / Roles)…"
                    value={paletteFilter}
                    onChange={(_e, v) => handlePaletteFilter(v)}
                    onClear={() => handlePaletteFilter('')}
                    data-testid="pb-palette-filter"
                  />
                </div>
                <BlocklyWorkspace
                  toolbox={toolbox}
                  height={640}
                  onChange={refreshFromWorkspace}
                  onWorkspaceReady={handleWorkspaceReady}
                />
              </div>
              <div style={{ flex: '1 1 26%', minWidth: 0 }}>
                <Title headingLevel="h3" size="sm" style={{ marginBottom: 8 }}>
                  Generated YAML
                </Title>
                <div data-testid="playbook-yaml-preview">
                  <CodeEditor value={playbookYaml} mode="yaml" readOnly rows={30} />
                </div>
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <Title headingLevel="h3" size="sm" style={{ marginBottom: 8 }}>
                  Variables
                </Title>
                <VariablesPanel projectId={projectId} roleNames={relevantRoles} />
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
              onClick={() => openDocument(o.path, o.mode, o.role)}
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
