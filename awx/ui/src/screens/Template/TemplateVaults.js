/* eslint-disable i18next/no-literal-string */
// awx-ng: Vault assignments for a job template — managed from the Vaults tab.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  FormGroup,
  Spinner,
} from '@patternfly/react-core';
import { CardBody } from 'components/Card';
import useRequest from 'hooks/useRequest';
import { listTemplateVaults, setTemplateVaults } from '../CustomVars/api';
import VaultSelect from './shared/VaultSelect';

function TemplateVaults() {
  const { id: templateId } = useParams();
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const { isLoading, error: loadError, request: load } = useRequest(
    useCallback(async () => {
      const { data } = await listTemplateVaults(templateId);
      setSelectedIds((data.results || []).map((v) => v.id));
    }, [templateId]),
    { isLoading: true }
  );

  useEffect(() => { load(); }, [load]);

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
    <CardBody>
      <Alert
        variant="info"
        isInline
        title="Ansible Vault Store"
        style={{ marginBottom: 16 }}
      >
        Variables from linked vaults are automatically injected as{' '}
        <strong>extra vars</strong> when this template runs.
        No <code>vars_files</code> needed.
      </Alert>

      {isLoading && <Spinner size="lg" />}
      {loadError && (
        <Alert variant="danger" title={String(loadError)} style={{ marginBottom: 8 }} />
      )}
      {saveError && (
        <Alert variant="danger" title={saveError} style={{ marginBottom: 8 }} />
      )}
      {saved && (
        <Alert variant="success" title="Vault assignments saved." isInline style={{ marginBottom: 8 }} />
      )}

      {!isLoading && (
        <>
          <FormGroup
            label="Vaults"
            helperText="Variables are injected automatically at job runtime."
            style={{ marginBottom: 16 }}
          >
            <VaultSelect
              selections={selectedIds}
              onChange={(ids) => { setSelectedIds(ids); setSaved(false); }}
            />
          </FormGroup>
          <Button variant="primary" onClick={save} isDisabled={saving}>
            {saving ? <Spinner size="sm" /> : 'Save vault assignments'}
          </Button>
        </>
      )}
    </CardBody>
  );
}

export default TemplateVaults;
