/* eslint react/no-unused-state: 0 */
/* eslint-disable i18next/no-literal-string */
import React, { useState, useCallback, useEffect } from 'react';
import { Redirect, useHistory } from 'react-router-dom';

import {
  Alert,
  Button,
  Checkbox,
  Divider,
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
import { listVaults, listTemplateVaults, setTemplateVaults } from '../../CustomVars/api';

function VaultSection({ templateId }) {
  const [allVaults, setAllVaults] = useState([]);
  const [linkedIds, setLinkedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const { isLoading: vaultsLoading, request: loadVaults } = useRequest(
    useCallback(async () => {
      const [allRes, linkedRes] = await Promise.all([
        listVaults(),
        listTemplateVaults(templateId),
      ]);
      setAllVaults(allRes.data.results || []);
      setLinkedIds(new Set((linkedRes.data.results || []).map((v) => v.id)));
    }, [templateId])
  );

  useEffect(() => { loadVaults(); }, [loadVaults]);

  const toggle = (id) => {
    setLinkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await setTemplateVaults(templateId, Array.from(linkedIds));
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
      <Title headingLevel="h2" size="xl" style={{ marginBottom: 8 }}>
        Linked Vaults
      </Title>
      <p style={{ color: '#666', marginBottom: 16, fontSize: 14 }}>
        Variables from linked vaults are automatically injected as extra vars when this template runs.
      </p>
      {vaultsLoading && <Spinner size="md" />}
      {saveError && (
        <Alert variant="danger" title={saveError} isInline style={{ marginBottom: 8 }} />
      )}
      {saved && (
        <Alert variant="success" title="Vault assignments saved." isInline style={{ marginBottom: 8 }} />
      )}
      {!vaultsLoading && allVaults.length === 0 && (
        <p style={{ color: '#999', fontSize: 13 }}>
          No vaults configured yet. Go to <strong>Resources → Vaults</strong> to create one.
        </p>
      )}
      {!vaultsLoading && allVaults.map((v) => (
        <div key={v.id} style={{ marginBottom: 10 }}>
          <Checkbox
            id={`vault-edit-${v.id}`}
            label={
              <span>
                <strong>{v.name}</strong>
                {v.description && (
                  <span style={{ color: '#666', marginLeft: 6 }}>— {v.description}</span>
                )}
                <span style={{
                  marginLeft: 8, fontSize: 11,
                  background: '#f0f0f0', borderRadius: 3, padding: '1px 5px',
                }}>
                  {v.variable_count ?? 0} var{v.variable_count !== 1 ? 's' : ''}
                </span>
              </span>
            }
            isChecked={linkedIds.has(v.id)}
            onChange={() => toggle(v.id)}
          />
        </div>
      ))}
      {!vaultsLoading && allVaults.length > 0 && (
        <Button
          variant="secondary"
          onClick={save}
          isDisabled={saving}
          style={{ marginTop: 8 }}
        >
          {saving ? <Spinner size="sm" /> : 'Save vault assignments'}
        </Button>
      )}
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
