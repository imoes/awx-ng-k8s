import React, { useCallback } from 'react';
import { func, bool, object } from 'prop-types';
import { t } from '@lingui/macro';
import { InventoriesAPI } from 'api';
import ResourceTypeaheadSelect from './ResourceTypeaheadSelect';

// Inventory picker as a typeahead dropdown (replaces the search-modal lookup
// in the Job Template form). Loads the first 200 inventories by name.
function InventorySelect({ value, onChange, isValid, onBlur }) {
  const loadOptions = useCallback(async () => {
    const { data } = await InventoriesAPI.read({
      page_size: 200,
      order_by: 'name',
    });
    return data.results;
  }, []);

  return (
    <ResourceTypeaheadSelect
      id="template-inventory"
      ouiaId="JobTemplateForm-inventory"
      value={value}
      onChange={onChange}
      loadOptions={loadOptions}
      isValid={isValid}
      onBlur={onBlur}
      placeholderText={t`Select an inventory`}
    />
  );
}

InventorySelect.propTypes = {
  value: object,
  onChange: func.isRequired,
  isValid: bool,
  onBlur: func,
};
InventorySelect.defaultProps = {
  value: null,
  isValid: true,
  onBlur: () => {},
};

export default InventorySelect;
