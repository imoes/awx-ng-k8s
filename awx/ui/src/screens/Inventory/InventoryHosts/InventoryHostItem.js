import React, { useCallback, useState } from 'react';
import { string, bool, func } from 'prop-types';
import { t } from '@lingui/macro';
import { Tr, Td } from '@patternfly/react-table';
import { Link } from 'react-router-dom';
import { PencilAltIcon, CopyIcon } from '@patternfly/react-icons';
import {
  Button,
  Chip,
  Checkbox,
  Form,
  FormGroup,
  Modal,
  TextInput,
} from '@patternfly/react-core';
import { HostsAPI } from 'api';
import AlertModal from 'components/AlertModal';
import ChipGroup from 'components/ChipGroup';
import ErrorDetail from 'components/ErrorDetail';
import HostToggle from 'components/HostToggle';
import { ActionsTd, ActionItem, TdBreakWord } from 'components/PaginatedTable';
import useRequest, { useDismissableError } from 'hooks/useRequest';
import { Host } from 'types';
import { cloneHost } from '../../CustomVars/api';

function InventoryHostItem({
  detailUrl,
  editUrl,
  host,
  isSelected,
  onSelect,
  onCloned,
  rowIndex,
}) {
  const labelId = `check-action-${host.id}`;
  const initialGroups = host?.summary_fields?.groups ?? {
    results: [],
    count: 0,
  };

  // ── Clone state ──────────────────────────────────────────────────────────
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneGroups, setCloneGroups] = useState(true);

  const {
    error: cloneError,
    isLoading: cloning,
    request: doClone,
  } = useRequest(
    useCallback(async () => {
      await cloneHost(host.id, cloneName.trim(), cloneGroups);
      setCloneOpen(false);
      if (onCloned) onCloned();
    }, [host.id, cloneName, cloneGroups, onCloned])
  );

  const { error: dismissableCloneError, dismissError: dismissCloneError } =
    useDismissableError(cloneError);

  const openClone = () => {
    setCloneName(`${host.name}-clone`);
    setCloneGroups(true);
    setCloneOpen(true);
  };

  const {
    error,
    request: fetchRelatedGroups,
    result: relatedGroups,
  } = useRequest(
    useCallback(async (hostId) => {
      const { data } = await HostsAPI.readGroups(hostId);
      return data.results;
    }, []),
    initialGroups.results
  );

  const { error: dismissableError, dismissError } = useDismissableError(error);

  const handleOverflowChipClick = (hostId) => {
    if (relatedGroups.length === initialGroups.count) {
      return;
    }
    fetchRelatedGroups(hostId);
  };

  return (
    <>
      <Tr id={`host-row-${host.id}`} ouiaId={`inventory-host-row-${host.id}`}>
        <Td
          data-cy={labelId}
          select={{
            rowIndex,
            isSelected,
            onSelect,
          }}
        />
        <TdBreakWord id={labelId} dataLabel={t`Name`}>
          <Link to={`${detailUrl}`}>
            <b>{host.name}</b>
          </Link>
        </TdBreakWord>
        <TdBreakWord
          id={`host-description-${host.id}`}
          dataLabel={t`Description`}
        >
          {host.description}
        </TdBreakWord>
        <TdBreakWord
          id={`host-related-groups-${host.id}`}
          dataLabel={t`Related Groups`}
        >
          <ChipGroup
            aria-label={t`Related Groups`}
            numChips={4}
            totalChips={initialGroups.count}
            ouiaId="host-related-groups-chips"
            onOverflowChipClick={() => handleOverflowChipClick(host.id)}
          >
            {relatedGroups.map((group) => (
              <Chip key={group.name} isReadOnly>
                {group.name}
              </Chip>
            ))}
          </ChipGroup>
        </TdBreakWord>
        <ActionsTd
          aria-label={t`Actions`}
          dataLabel={t`Actions`}
          gridColumns="auto 40px 40px"
        >
          <HostToggle host={host} />
          <ActionItem
            visible={host.summary_fields.user_capabilities?.copy}
            tooltip={t`Clone host`}
          >
            <Button
              aria-label={t`Clone host`}
              ouiaId={`${host.id}-clone-button`}
              variant="plain"
              onClick={openClone}
            >
              <CopyIcon />
            </Button>
          </ActionItem>
          <ActionItem
            visible={host.summary_fields.user_capabilities?.edit}
            tooltip={t`Edit host`}
          >
            <Button
              aria-label={t`Edit host`}
              ouiaId={`${host.id}-edit-button`}
              variant="plain"
              component={Link}
              to={`${editUrl}`}
            >
              <PencilAltIcon />
            </Button>
          </ActionItem>
        </ActionsTd>
      </Tr>
      {cloneOpen && (
        <Modal
          title={t`Clone host`}
          isOpen
          variant="small"
          onClose={() => setCloneOpen(false)}
          actions={[
            <Button
              key="clone"
              variant="primary"
              isDisabled={cloning || !cloneName.trim()}
              isLoading={cloning}
              onClick={doClone}
            >
              {t`Clone`}
            </Button>,
            <Button
              key="cancel"
              variant="link"
              onClick={() => setCloneOpen(false)}
            >
              {t`Cancel`}
            </Button>,
          ]}
        >
          <Form>
            <FormGroup label={t`New host name`} fieldId="clone-host-name" isRequired>
              <TextInput
                id="clone-host-name"
                value={cloneName}
                onChange={(v) =>
                  setCloneName(typeof v === 'string' ? v : v?.target?.value ?? '')
                }
                autoFocus
              />
            </FormGroup>
            <FormGroup fieldId="clone-host-groups">
              <Checkbox
                id="clone-host-groups"
                label={t`Copy group memberships`}
                isChecked={cloneGroups}
                onChange={(checked) =>
                  setCloneGroups(
                    typeof checked === 'boolean' ? checked : checked?.target?.checked
                  )
                }
              />
            </FormGroup>
          </Form>
        </Modal>
      )}
      {dismissableError && (
        <AlertModal
          isOpen={dismissableError}
          onClose={dismissError}
          title={t`Error!`}
          variant="error"
        >
          {t`Failed to load related groups.`}
          <ErrorDetail error={dismissableError} />
        </AlertModal>
      )}
      {dismissableCloneError && (
        <AlertModal
          isOpen={dismissableCloneError}
          onClose={dismissCloneError}
          title={t`Error!`}
          variant="error"
        >
          {t`Failed to clone host.`}
          <ErrorDetail error={dismissableCloneError} />
        </AlertModal>
      )}
    </>
  );
}

InventoryHostItem.propTypes = {
  detailUrl: string.isRequired,
  host: Host.isRequired,
  isSelected: bool.isRequired,
  onSelect: func.isRequired,
  onCloned: func,
};

InventoryHostItem.defaultProps = {
  onCloned: null,
};

export default InventoryHostItem;
