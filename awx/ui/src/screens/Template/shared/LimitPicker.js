/* eslint-disable i18next/no-literal-string */
// awx-ng: picker that lets the user choose hosts and/or groups from the selected
// inventory and writes them (comma-separated names) into the job template `limit`.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { t } from '@lingui/macro';
import {
  Button,
  Chip,
  ChipGroup,
  Modal,
  SearchInput,
  Spinner,
  Tab,
  Tabs,
  TabTitleText,
} from '@patternfly/react-core';
import {
  TableComposable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';
import { InventoriesAPI } from 'api';

function LimitPicker({ inventoryId, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [hosts, setHosts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Parse the current limit string into a set of selected names.
  const selected = useMemo(
    () =>
      new Set(
        (value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    [value]
  );

  const load = useCallback(async () => {
    if (!inventoryId) return;
    setLoading(true);
    try {
      const [h, g] = await Promise.all([
        InventoriesAPI.readHosts(inventoryId, { page_size: 200, order_by: 'name' }),
        InventoriesAPI.readGroups(inventoryId, { page_size: 200, order_by: 'name' }),
      ]);
      setHosts(h.data.results || []);
      setGroups(g.data.results || []);
    } catch {
      setHosts([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [inventoryId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const commit = (names) => onChange(Array.from(names).join(','));

  const toggle = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    commit(next);
  };

  const items = activeTab === 0 ? hosts : groups;
  const q = search.trim().toLowerCase();
  const filtered = q.length
    ? items.filter((i) => i.name.toLowerCase().includes(q))
    : items;

  return (
    <>
      <Button
        variant="secondary"
        isSmall
        isDisabled={!inventoryId}
        onClick={() => setIsOpen(true)}
        style={{ marginTop: 4 }}
      >
        {t`Select from inventory…`}
      </Button>
      {selected.size > 0 && (
        <ChipGroup style={{ marginTop: 6 }} numChips={8}>
          {Array.from(selected).map((name) => (
            <Chip key={name} onClick={() => toggle(name)}>
              {name}
            </Chip>
          ))}
        </ChipGroup>
      )}

      {isOpen && (
        <Modal
          title={t`Select hosts / groups`}
          isOpen
          variant="medium"
          onClose={() => setIsOpen(false)}
          actions={[
            <Button key="done" variant="primary" onClick={() => setIsOpen(false)}>
              {t`Done`}
            </Button>,
          ]}
        >
          <p style={{ marginBottom: 8, color: '#6a6e73' }}>
            {t`Selected hosts and groups are written to the limit as a comma-separated pattern.`}
          </p>
          <Tabs activeKey={activeTab} onSelect={(_e, k) => setActiveTab(k)}>
            <Tab eventKey={0} title={<TabTitleText>{t`Hosts`}</TabTitleText>} />
            <Tab eventKey={1} title={<TabTitleText>{t`Groups`}</TabTitleText>} />
          </Tabs>
          <SearchInput
            placeholder={t`Filter…`}
            value={search}
            onChange={(_e, v) => setSearch(typeof v === 'string' ? v : _e?.target?.value ?? '')}
            onClear={() => setSearch('')}
            style={{ margin: '8px 0' }}
          />
          {loading ? (
            <Spinner />
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              <TableComposable variant="compact" aria-label="inventory items">
                <Thead>
                  <Tr>
                    <Th />
                    <Th>{activeTab === 0 ? t`Host` : t`Group`}</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.map((i) => (
                    <Tr
                      key={i.id}
                      isHoverable
                      onRowClick={() => toggle(i.name)}
                      isRowSelected={selected.has(i.name)}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={selected.has(i.name)}
                          onChange={() => toggle(i.name)}
                          aria-label={`select ${i.name}`}
                        />
                      </Td>
                      <Td>{i.name}</Td>
                    </Tr>
                  ))}
                  {filtered.length === 0 && (
                    <Tr>
                      <Td colSpan={2} style={{ color: '#6a6e73' }}>
                        {t`Nothing to show.`}
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </TableComposable>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

LimitPicker.propTypes = {
  inventoryId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

LimitPicker.defaultProps = {
  inventoryId: null,
  value: '',
};

export default LimitPicker;
