/* eslint-disable i18next/no-literal-string */
// awx-ng: right-side list of variables the user can drag onto a text field
// on the Blockly canvas to insert a {{ name }} Jinja reference. Sourced from
// the selected project's scanned role variables and any Ansible Vault
// variable names (both are already the "real" injectable variable pool for
// a job — see customvars/api.py's role scan + vault extra_vars injection).
import React, { useCallback, useEffect, useState } from 'react';
import { TextInput } from '@patternfly/react-core';
import useRequest from 'hooks/useRequest';
import { readProjectRoleVariables, listVaults, getVault } from '../api';

async function loadVariables(projectId) {
  if (!projectId) return [];
  const [roleVarsRes, vaultsRes] = await Promise.all([
    readProjectRoleVariables(projectId),
    listVaults(),
  ]);
  const roleVars = (roleVarsRes.data.results || []).map((v) => ({
    name: v.var_name,
    source: `role: ${v.role_name}`,
  }));
  const vaultDetails = await Promise.all(
    (vaultsRes.data.results || []).map((v) => getVault(v.id))
  );
  const vaultVars = vaultDetails.flatMap((res) =>
    Object.keys(res.data.variables || {}).map((name) => ({
      name,
      source: `vault: ${res.data.name}`,
    }))
  );
  const seen = new Set();
  return [...roleVars, ...vaultVars].filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
}

function VariablesPanel({ projectId }) {
  const [search, setSearch] = useState('');
  const [vars, setVars] = useState([]);

  const { request: reload } = useRequest(
    useCallback(async () => {
      setVars(await loadVariables(projectId));
    }, [projectId])
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
          <p style={{ color: '#888', fontSize: 12 }}>No variables found for this project.</p>
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
            <div style={{ color: '#888', fontSize: 10 }}>{v.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default VariablesPanel;
