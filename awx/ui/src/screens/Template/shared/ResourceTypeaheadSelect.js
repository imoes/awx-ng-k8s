import React, { useCallback, useEffect, useState } from 'react';
import { func, bool, string, object } from 'prop-types';
import { t } from '@lingui/macro';
import { SelectVariant, Select, SelectOption } from '@patternfly/react-core';
import useRequest from 'hooks/useRequest';

// Single-select typeahead dropdown over a list of resource objects (e.g.
// inventories or projects). Loads the full objects so the selected value keeps
// its summary_fields etc., and filters by case-insensitive substring on name —
// so typing part of the name is enough, no exact prefix required.
//
// Each option carries a toString() returning its name so PatternFly renders the
// name in the input; the original object fields are preserved for onChange.
function wrap(item) {
  if (!item) return null;
  return { ...item, toString: () => item.name };
}

function ResourceTypeaheadSelect({
  value,
  onChange,
  loadOptions,
  id,
  ouiaId,
  placeholderText,
  isValid,
  onBlur,
}) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    result: options,
    request: fetchOptions,
    isLoading,
  } = useRequest(
    useCallback(async () => {
      const items = await loadOptions();
      return items.map(wrap);
    }, [loadOptions]),
    []
  );

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  const renderOptions = (opts) =>
    opts.map((opt) => (
      <SelectOption key={opt.id} value={opt} aria-label={opt.name}>
        {opt.name}
      </SelectOption>
    ));

  const onFilter = (event) => {
    const typed = (event?.target?.value || '').toLowerCase();
    const matches = typed
      ? options.filter((o) => o.name.toLowerCase().includes(typed))
      : options;
    return renderOptions(matches);
  };

  // Display the current value even before the option list has loaded.
  const selection = value ? wrap(value) : null;

  return (
    <Select
      ouiaId={ouiaId}
      id={id}
      variant={SelectVariant.typeahead}
      isOpen={isOpen}
      onToggle={setIsOpen}
      selections={selection}
      onSelect={(event, item) => {
        setIsOpen(false);
        onChange(item || null);
      }}
      onClear={() => onChange(null)}
      onFilter={onFilter}
      onBlur={onBlur}
      isDisabled={isLoading}
      validated={isValid ? 'default' : 'error'}
      placeholderText={placeholderText}
      typeAheadAriaLabel={placeholderText}
      maxHeight="40vh"
      noResultsFoundText={t`No results found`}
    >
      {renderOptions(options)}
    </Select>
  );
}

ResourceTypeaheadSelect.propTypes = {
  value: object,
  onChange: func.isRequired,
  loadOptions: func.isRequired,
  id: string,
  ouiaId: string,
  placeholderText: string,
  isValid: bool,
  onBlur: func,
};
ResourceTypeaheadSelect.defaultProps = {
  value: null,
  id: undefined,
  ouiaId: undefined,
  placeholderText: '',
  isValid: true,
  onBlur: () => {},
};

export default ResourceTypeaheadSelect;
