/* eslint-disable i18next/no-literal-string */
// awx-ng: right-side list of variables the user can drag onto a text field
// on the Blockly canvas to insert a {{ name }} Jinja reference.
//
// Scope: only variables relevant to the *currently open* document —
// role variables for the roles actually used in this playbook (or the role
// being edited), plus Ansible Vault variable names. NOT every role in the
// project (that was the original, confusing behaviour).
import React, { useCallback, useEffect, useState } from 'react';
import { Button, TextInput } from '@patternfly/react-core';
import useRequest from 'hooks/useRequest';
import { readProjectRoleVariables, listVaults, getVault } from '../api';
import { ANSIBLE_FACT_VARIABLES, ANSIBLE_MAGIC_VARIABLES } from './ansibleFacts';

// Short, single-line preview of a variable's value/default so the user can
// see what a variable actually holds.
function previewValue(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

async function loadVariables(projectId, roleNames) {
  // ansible_facts and magic variables are always available (facts are
  // gathered on every play by default; magic variables are computed by
  // Ansible itself), independent of project/role — shown regardless of the
  // open document.
  if (!projectId) return [...ANSIBLE_FACT_VARIABLES, ...ANSIBLE_MAGIC_VARIABLES];
  const roleSet = new Set(roleNames);

  const [roleVarsRes, vaultsRes] = await Promise.all([
    roleSet.size ? readProjectRoleVariables(projectId) : Promise.resolve({ data: { results: [] } }),
    listVaults(),
  ]);

  // Only role variables belonging to roles present in the current document.
  const roleVars = (roleVarsRes.data.results || [])
    .filter((v) => roleSet.has(v.role_name))
    .map((v) => ({
      name: v.var_name,
      source: `role: ${v.role_name}`,
      preview: previewValue(v.default_value),
    }));

  const vaultDetails = await Promise.all(
    (vaultsRes.data.results || []).map((v) => getVault(v.id))
  );
  const vaultVars = vaultDetails.flatMap((res) =>
    Object.entries(res.data.variables || {}).map(([name, value]) => ({
      name,
      source: `vault: ${res.data.name}`,
      preview: previewValue(value),
    }))
  );

  const seen = new Set();
  return [...roleVars, ...vaultVars, ...ANSIBLE_FACT_VARIABLES, ...ANSIBLE_MAGIC_VARIABLES].filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
}

function VariablesPanel({ projectId, roleNames, localVars = [], onCreateVariable }) {
  const [search, setSearch] = useState('');
  const [vars, setVars] = useState([]);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  // Stable primitive dependency so the effect re-runs only when the actual
  // set of relevant roles changes, not on every parent re-render.
  const roleKey = [...roleNames].sort().join(',');

  const { request: reload } = useRequest(
    useCallback(async () => {
      setVars(await loadVariables(projectId, roleKey ? roleKey.split(',') : []));
    }, [projectId, roleKey])
  );
  useEffect(() => { reload(); }, [reload]);

  // Variables just defined on the current canvas (a play's vars: or a
  // role's Defaults/Vars tab) take priority over same-named fetched entries
  // — they're the most current source of truth for this document.
  const seen = new Set();
  const allVars = [...localVars, ...vars].filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
  const filtered = allVars.filter(
    (v) => !search || v.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || !onCreateVariable) return;
    onCreateVariable(name, newValue);
    setNewName('');
    setNewValue('');
  };

  const handleDragStart = (event, name) => {
    event.dataTransfer.setData('text/plain', name);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const handleClick = async (name) => {
    try {
      await navigator.clipboard.writeText(`{{ ${name} }}`);
    } catch {
      // Clipboard API can be unavailable (permissions, non-HTTPS context);
      // dragging remains the primary way to insert a reference either way.
    }
  };

  return (
    <div data-testid="pb-variables-panel" style={{ width: 220, flexShrink: 0 }}>
      {onCreateVariable && (
        <div
          data-testid="pb-add-variable-form"
          style={{ marginBottom: 10, padding: 6, border: '1px solid #ddd', borderRadius: 4, background: '#fafafa' }}
        >
          <TextInput
            aria-label="New variable name"
            placeholder="New variable name…"
            value={newName}
            onChange={setNewName}
            data-testid="pb-add-variable-name"
            style={{ marginBottom: 4 }}
          />
          <TextInput
            aria-label="New variable value"
            placeholder="Value (optional)…"
            value={newValue}
            onChange={setNewValue}
            data-testid="pb-add-variable-value"
            style={{ marginBottom: 4 }}
          />
          <Button
            variant="secondary"
            isBlock
            isDisabled={!newName.trim()}
            onClick={handleCreate}
            data-testid="pb-add-variable-button"
          >
            + Add variable
          </Button>
        </div>
      )}
      <TextInput
        aria-label="Filter variables"
        placeholder="Filter variables…"
        value={search}
        onChange={setSearch}
        style={{ marginBottom: 8 }}
      />
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <p style={{ color: '#888', fontSize: 12 }}>
            No variables for the current playbook/role. Add a role, or open a
            playbook/role that uses roles with variables.
          </p>
        )}
        {filtered.map((v) => (
          <div
            key={`${v.source}:${v.name}`}
            draggable
            onDragStart={(e) => handleDragStart(e, v.name)}
            onClick={() => handleClick(v.name)}
            data-testid="pb-variable-item"
            data-varname={v.name}
            title={`Click to copy {{ ${v.name} }} — or drag onto a text field to insert, or onto the canvas for a var block`}
            style={{
              // Mimics the actual Blockly cond_var block's colour/bevel
              // (setColour(65) → Blockly's default HSV hue conversion,
              // ~#A0A65B) — dragging any of these onto blank canvas creates
              // exactly that block, so the panel should look like it.
              padding: '5px 6px 6px',
              marginBottom: 6,
              borderRadius: 4,
              border: '1px solid #7d8347',
              background: 'linear-gradient(180deg, #b7bd74 0%, #9da35a 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(0,0,0,0.15)',
              cursor: 'grab',
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: 'inline-block',
                background: '#fff',
                color: '#1a1a1a',
                borderRadius: 3,
                padding: '1px 6px',
                fontWeight: 600,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {v.name}
            </div>
            {v.preview !== '' && (
              <div style={{ color: '#2c2f16', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 3 }}>
                = {v.preview}
              </div>
            )}
            <div style={{ color: '#40421f', fontSize: 10, marginTop: 1 }}>{v.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default VariablesPanel;
