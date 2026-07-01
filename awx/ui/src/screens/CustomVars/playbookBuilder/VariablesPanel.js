/* eslint-disable i18next/no-literal-string */
// awx-ng: right-side list of variables the user can drag onto a text field
// on the Blockly canvas to insert a {{ name }} Jinja reference.
//
// Scope: only variables relevant to the *currently open* document —
// role variables for the roles actually used in this playbook (or the role
// being edited), plus Ansible Vault variable names. NOT every role in the
// project (that was the original, confusing behaviour).
import React, { useCallback, useEffect, useState } from 'react';
import { TextInput } from '@patternfly/react-core';
import useRequest from 'hooks/useRequest';
import { readProjectRoleVariables, listVaults, getVault } from '../api';

// Short, single-line preview of a variable's value/default so the user can
// see what a variable actually holds.
function previewValue(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

async function loadVariables(projectId, roleNames) {
  if (!projectId) return [];
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
  return [...roleVars, ...vaultVars].filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
}

function VariablesPanel({ projectId, roleNames }) {
  const [search, setSearch] = useState('');
  const [vars, setVars] = useState([]);
  // Stable primitive dependency so the effect re-runs only when the actual
  // set of relevant roles changes, not on every parent re-render.
  const roleKey = [...roleNames].sort().join(',');

  const { request: reload } = useRequest(
    useCallback(async () => {
      setVars(await loadVariables(projectId, roleKey ? roleKey.split(',') : []));
    }, [projectId, roleKey])
  );
  useEffect(() => { reload(); }, [reload]);

  const filtered = vars.filter(
    (v) => !search || v.name.toLowerCase().includes(search.toLowerCase())
  );

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
      <TextInput
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
            title={`Click to copy {{ ${v.name} }} — or drag onto a text field to insert`}
            style={{
              padding: '4px 8px',
              marginBottom: 4,
              border: '1px solid #ddd',
              borderRadius: 4,
              cursor: 'grab',
              fontSize: 12,
              background: '#fafafa',
            }}
          >
            <strong>{v.name}</strong>
            {v.preview !== '' && (
              <div style={{ color: '#444', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                = {v.preview}
              </div>
            )}
            <div style={{ color: '#888', fontSize: 10 }}>{v.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default VariablesPanel;
