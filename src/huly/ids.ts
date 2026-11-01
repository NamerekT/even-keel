/**
 * Ids of Huly's tracker plugin, the same strings `@hcengineering/tracker` defines. The package itself is not a
 * dependency: it pulls in Huly's web front end (~49 MB, ~12,000 files) for these few constants.
 */
export const tracker = {
  class: {
    Issue: 'tracker:class:Issue',
    IssueStatus: 'tracker:class:IssueStatus',
    Project: 'tracker:class:Project',
    Milestone: 'tracker:class:Milestone',
    Component: 'tracker:class:Component',
    TimeSpendReport: 'tracker:class:TimeSpendReport',
  },
  ids: { NoParent: 'tracker:ids:NoParent' },
  taskTypes: { Issue: 'tracker:taskTypes:Issue' },
} as const
