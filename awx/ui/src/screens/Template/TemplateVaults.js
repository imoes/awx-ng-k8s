/* eslint-disable i18next/no-literal-string */
// awx-ng: Vault assignments for a job template — managed from the template side.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Checkbox,
  Spinner,
} from '@patternfly/react-core';
import { CardBody } from 'components/Card';
import useRequest from 'hooks/useRequest';
import {
  listVaults,
  listTemplateVaults,
  setTemplateVaults,
} from '../CustomVars/api';

function TemplateVaults() {
  const { id: templateId } = useParams();
  const [allVaults, setAllVaults] = useState([]);
  const [linkedIds, setLinkedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const { isLoading, error: loadError, request: load } = useRequest(
    useCallback(async () => {
      const [allRes, linkedRes] = await Promise.all([
        listVaults(),
        listTemplateVaults(templateId),
      ]);
      setAllVaults(allRes.data.results || []);
      setLinkedIds(new Set((linkedRes.data.results || []).map((v) => v.id)));
    }, [templateId]),
    { isLoading: true }
  );

  useEffect(() => { load(); }, [load]);

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
    setSaved(false);
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
    <CardBody>
      <Alert
        variant="info"
        isInline
        title="Ansible Vault Store"
        style={{ marginBottom: 16 }}
      >
        Variables from linked vaults are automatically injected as{' '}
        <strong>extra vars</strong> when this template runs.
        No <code>vars_files</code> needed — the vault password is managed by awx-ng.
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

      {!isLoading && allVaults.length === 0 && (
        <p style={{ color: '#888' }}>
          No vaults configured yet. Go to{' '}
          <strong>Resources → Vaults</strong> to create one.
        </p>
      )}

      {!isLoading && allVaults.length > 0 && (
        <>
          <div style={{ marginBottom: 16 }}>
            {allVaults.map((v) => (
              <div key={v.id} style={{ marginBottom: 10 }}>
                <Checkbox
                  id={`vault-${v.id}`}
                  label={
                    <span>
                      <strong>{v.name}</strong>
                      {v.description && (
                        <span style={{ color: '#666', marginLeft: 6 }}>— {v.description}</span>
                      )}
                      <span style={{
                        marginLeft: 8,
                        fontSize: 11,
                        background: '#f0f0f0',
                        borderRadius: 3,
                        padding: '1px 5px',
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
          </div>
          <Button
            variant="primary"
            onClick={save}
            isDisabled={saving}
          >
            {saving ? <Spinner size="sm" /> : 'Save vault assignments'}
          </Button>
        </>
      )}
    </CardBody>
  );
}

export default TemplateVaults;
