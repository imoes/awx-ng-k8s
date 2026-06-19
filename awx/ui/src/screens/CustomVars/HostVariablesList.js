/* eslint-disable i18next/no-literal-string */
// awx-ng: searchable host list (like Resources > Hosts) — click a host to
// manage its role variables.
import React, { useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, PageSection } from '@patternfly/react-core';
import { Tr, Td } from '@patternfly/react-table';
import ScreenHeader from 'components/ScreenHeader/ScreenHeader';
import PaginatedTable, {
  HeaderRow,
  HeaderCell,
} from 'components/PaginatedTable';
import DataListToolbar from 'components/DataListToolbar';
import useRequest from 'hooks/useRequest';
import { getQSConfig, parseQueryString } from 'util/qs';
import { HostsAPI } from 'api';

const QS_CONFIG = getQSConfig('host', {
  page: 1,
  page_size: 20,
  order_by: 'name',
});

function HostVariablesList() {
  const location = useLocation();

  const {
    result: { count, results },
    isLoading,
    error,
    request: fetchHosts,
  } = useRequest(
    useCallback(async () => {
      const params = parseQueryString(QS_CONFIG, location.search);
      const { data } = await HostsAPI.read(params);
      return { count: data.count, results: data.results };
    }, [location]),
    { count: 0, results: [] }
  );

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  return (
    <>
      <ScreenHeader
        streamType="none"
        breadcrumbConfig={{ '/host_variables': 'Host Variables' }}
      />
      <PageSection>
        <Card>
          <PaginatedTable
            contentError={error}
            hasContentLoading={isLoading}
            items={results}
            itemCount={count}
            pluralizedItemName="Hosts"
            qsConfig={QS_CONFIG}
            toolbarSearchColumns={[
              { name: 'Name', key: 'name__icontains', isDefault: true },
            ]}
            toolbarSearchableKeys={[]}
            toolbarRelatedSearchableKeys={[]}
            renderToolbar={(props) => (
              <DataListToolbar {...props} fillWidth advancedSearchDisabled />
            )}
            headerRow={
              <HeaderRow qsConfig={QS_CONFIG}>
                <HeaderCell sortKey="name">Name</HeaderCell>
                <HeaderCell>Description</HeaderCell>
              </HeaderRow>
            }
            renderRow={(host) => (
              <Tr key={host.id} id={`host-row-${host.id}`}>
                <Td dataLabel="Name">
                  <Link to={`/host_variables/${host.id}`}>{host.name}</Link>
                </Td>
                <Td dataLabel="Description">{host.description}</Td>
              </Tr>
            )}
          />
        </Card>
      </PageSection>
    </>
  );
}

export default HostVariablesList;
