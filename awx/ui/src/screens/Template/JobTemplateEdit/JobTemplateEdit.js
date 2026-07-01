/* eslint react/no-unused-state: 0 */
/* eslint-disable i18next/no-literal-string */
import React, { useState, useCallback, useEffect } from 'react';
import { Redirect, useHistory } from 'react-router-dom';

import {
  Alert,
  Button,
  Divider,
  FormGroup,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { JobTemplate } from 'types';
import { JobTemplatesAPI, ProjectsAPI } from 'api';
import { getAddedAndRemoved } from 'util/lists';
import useRequest from 'hooks/useRequest';
import ContentLoading from 'components/ContentLoading';
import { CardBody } from 'components/Card';
import JobTemplateForm from '../shared/JobTemplateForm';
import VaultSelect from '../shared/VaultSelect';
import { listTemplateVaults, setTemplateVaults } from '../../CustomVars/api';

function VaultSection({ templateId }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const { request: loadLinked } = useRequest(
    useCallback(async () => {
      const { data } = await listTemplateVaults(templateId);
      setSelectedIds((data.results || []).map((v) => v.id));
    }, [templateId])
  );

  useEffect(() => { loadLinked(); }, [loadLinked]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await setTemplateVaults(templateId, selectedIds);
      setSaved(true);
    } catch (e) {
      setSaveError(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <Divider style={{ marginBottom: 24 }} />
      <Title headingLevel="h2" size="xl" style={{ marginBottom: 16 }}>
        Linked Vaults
      </Title>
      {saveError && (
        <Alert variant="danger" title={saveError} isInline style={{ marginBottom: 8 }} />
      )}
      {saved && (
        <Alert variant="success" title="Vault assignments saved." isInline style={{ marginBottom: 8 }} />
      )}
      <FormGroup
        label="Vaults"
        helperText="Variables are automatically injected as extra vars when this template runs."
      >
        <VaultSelect
          selections={selectedIds}
          onChange={(ids) => { setSelectedIds(ids); setSaved(false); }}
        />
      </FormGroup>
      <Button
        variant="secondary"
        onClick={save}
        isDisabled={saving}
        style={{ marginTop: 16 }}
      >
        {saving ? <Spinner size="sm" /> : 'Save vault assignments'}
      </Button>
    </div>
  );
}

function JobTemplateEdit({ template, reloadTemplate }) {
  const history = useHistory();
  const [formSubmitError, setFormSubmitError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);

  const detailsUrl = `/templates/${template.type}/${template.id}/details`;

  const { request: fetchProject, error: fetchProjectError } = useRequest(
    useCallback(async () => {
      await ProjectsAPI.readDetail(template.project);
    }, [template.project])
  );

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    if (fetchProjectError) {
      if (fetchProjectError.response.status === 403) {
        setIsDisabled(true);
      }
    }
  }, [fetchProjectError]);

  const handleSubmit = async (values) => {
    const {
      labels,
      instanceGroups,
      initialInstanceGroups,
      credentials,
      inventory,
      project,
      webhook_credential,
      webhook_key,
      webhook_url,
      execution_environment,
      ...remainingValues
    } = values;

    setFormSubmitError(null);
    setIsLoading(true);
    remainingValues.project = project.id;
    remainingValues.webhook_credential = webhook_credential?.id || null;
    remainingValues.inventory = inventory?.id || null;
    remainingValues.execution_environment = execution_environment?.id || null;
    try {
      await JobTemplatesAPI.update(template.id, remainingValues);
      await Promise.all([
        submitLabels(template?.organization, labels),
        submitCredentials(credentials),
        JobTemplatesAPI.orderInstanceGroups(
          template.id,
          instanceGroups,
          initialInstanceGroups
        ),
      ]);
      reloadTemplate();
      history.push(detailsUrl);
    } catch (error) {
      setFormSubmitError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const submitLabels = async (orgId, labels = []) => {
    const { added, removed } = getAddedAndRemoved(
      template.summary_fields.labels.results,
      labels
    );

    const disassociationPromises = removed.map((label) =>
      JobTemplatesAPI.disassociateLabel(template.id, label)
    );
    const associationPromises = added.map((label) =>
      JobTemplatesAPI.associateLabel(template.id, label, orgId)
    );

    const results = await Promise.all([
      ...disassociationPromises,
      ...associationPromises,
    ]);
    return results;
  };

  const submitCredentials = async (newCredentials) => {
    const { added, removed } = getAddedAndRemoved(
      template.summary_fields.credentials,
      newCredentials
    );
    const disassociateCredentials = removed.map((cred) =>
      JobTemplatesAPI.disassociateCredentials(template.id, cred.id)
    );
    const disassociatePromise = await Promise.all(disassociateCredentials);
    const associateCredentials = added.map((cred) =>
      JobTemplatesAPI.associateCredentials(template.id, cred.id)
    );
    const associatePromise = await Promise.all(associateCredentials);
    return Promise.all([disassociatePromise, associatePromise]);
  };

  const handleCancel = () => history.push(detailsUrl);

  const canEdit = template?.summary_fields?.user_capabilities?.edit;

  if (!canEdit) {
    return <Redirect to={detailsUrl} />;
  }
  if (isLoading) {
    return <ContentLoading />;
  }

  return (
    <CardBody>
      <JobTemplateForm
        template={template}
        handleCancel={handleCancel}
        handleSubmit={handleSubmit}
        submitError={formSubmitError}
        isOverrideDisabledLookup={!isDisabled}
      />
      <VaultSection templateId={template.id} />
    </CardBody>
  );
}

JobTemplateEdit.propTypes = {
  template: JobTemplate.isRequired,
};
export default JobTemplateEdit;
