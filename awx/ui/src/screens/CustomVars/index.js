/* eslint-disable i18next/no-literal-string */
// awx-ng: screen exports + internal routing for the host-variables list/detail.
import React from 'react';
import { Switch, Route } from 'react-router-dom';
import HostVariablesList from './HostVariablesList';
import HostVariables from './HostVariables';

export { default as Locations } from './Locations';
export { default as RunnerSites } from './RunnerSites';

// Combined router: /host_variables (list) and /host_variables/:id (detail)
export function HostVariablesRouter() {
  return (
    <Switch>
      <Route path="/host_variables/:id">
        <HostVariables />
      </Route>
      <Route path="/host_variables">
        <HostVariablesList />
      </Route>
    </Switch>
  );
}
