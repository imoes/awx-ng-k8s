/* eslint-disable i18next/no-literal-string */
// awx-ng: Multi-select for linked Ansible vaults — mirrors PlaybookSelect style.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Select,
  SelectOption,
  SelectVariant,
} from '@patternfly/react-core';
import useRequest from 'hooks/useRequest';
import { listVaults } from '../../CustomVars/api';

// selections: array of vault IDs (strings)
// onChange:   (newIds: string[]) => void
function VaultSelect({ selections, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [vaultMap, setVaultMap] = useState({}); // id → vault

  const { result: vaults, request: fetchVaults, isLoading } = useRequest(
    useCallback(async () => {
      const { data } = await listVaults();
      return data.results || [];
    }, []),
    []
  );

  useEffect(() => { fetchVaults(); }, [fetchVaults]);

  useEffect(() => {
    if (vaults && vaults.length) {
      const map = {};
      vaults.forEach((v) => { map[v.id] = v; });
      setVaultMap(map);
    }
  }, [vaults]);

  // Chip labels — show vault name instead of raw UUID
  const chipLabels = selections.map((id) => (vaultMap[id] ? vaultMap[id].name : id));

  const onToggle = (open) => setIsOpen(open);

  const onSelect = (event, value) => {
    // value is the vault name; look up the ID
    const vault = (vaults || []).find((v) => v.name === value);
    if (!vault) return;
    const alreadySelected = selections.includes(vault.id);
    const next = alreadySelected
      ? selections.filter((id) => id !== vault.id)
      : [...selections, vault.id];
    onChange(next);
  };

  const onClear = () => onChange([]);

  const onFilter = (event) => {
    const typed = (event?.target?.value || '').toLowerCase();
    const list = typed
      ? (vaults || []).filter((v) => v.name.toLowerCase().includes(typed))
      : (vaults || []);
    return list.map((v) => (
      <SelectOption
        key={v.id}
        value={v.name}
        description={`${v.variable_count ?? 0} variable${v.variable_count !== 1 ? 's' : ''}`}
      />
    ));
  };

  return (
    <Select
      variant={SelectVariant.typeaheadMulti}
      isOpen={isOpen}
      onToggle={onToggle}
      selections={chipLabels}
      onSelect={onSelect}
      onClear={onClear}
      onFilter={onFilter}
      placeholderText="Select vaults…"
      isDisabled={isLoading}
      maxHeight="300px"
      noResultsFoundText="No vaults found"
    >
      {(vaults || []).map((v) => (
        <SelectOption
          key={v.id}
          value={v.name}
          description={`${v.variable_count ?? 0} variable${v.variable_count !== 1 ? 's' : ''}`}
        />
      ))}
    </Select>
  );
}

export default VaultSelect;
