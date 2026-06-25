import React, { useCallback } from 'react';
import { func, bool, object } from 'prop-types';
import { t } from '@lingui/macro';
import { ProjectsAPI } from 'api';
import ResourceTypeaheadSelect from './ResourceTypeaheadSelect';

// Project picker as a typeahead dropdown (replaces the search-modal lookup in
// the Job Template form). Loads the first 200 projects by name.
function ProjectSelect({ value, onChange, isValid, onBlur }) {
  const loadOptions = useCallback(async () => {
    const { data } = await ProjectsAPI.read({
      page_size: 200,
      order_by: 'name',
    });
    return data.results;
  }, []);

  return (
    <ResourceTypeaheadSelect
      id="template-project"
      ouiaId="JobTemplateForm-project"
      value={value}
      onChange={onChange}
      loadOptions={loadOptions}
      isValid={isValid}
      onBlur={onBlur}
      placeholderText={t`Select a project`}
    />
  );
}

ProjectSelect.propTypes = {
  value: object,
  onChange: func.isRequired,
  isValid: bool,
  onBlur: func,
};
ProjectSelect.defaultProps = {
  value: null,
  isValid: true,
  onBlur: () => {},
};

export default ProjectSelect;
