export const eventsEn = {
  /** The line under a toast's title, by the entry's code; a code without one shows the title alone. */
  hints: {
    'eventLog.limit': 'Switch the account or wait for the reset.',
    'eventLog.red': 'The next task waits until main is green again.',
    'eventLog.ciRed': 'This CI does not decide whether the chain continues.',
    'eventLog.ask': 'Answer it in the session’s chat window.',
    'eventLog.conflict': 'Merge it by hand or press “Resolve with the agent” on the project’s page.',
    'eventLog.uncommitted': 'The task left the chain; its work is still in its folder.',
    'eventLog.unmerged': 'The task left the chain; its work is still in its folder.',
    'eventLog.chainHeld': 'Open the project to see why and to go on.',
  } as Partial<Record<string, string>>,
  open: 'Open',
  close: 'Close',
  log: 'Log',
  title: 'Event log',
  help: 'What happened while you were away: launches, stops and setting changes, and every warning and error the page showed. A warning or an error also comes as a notification for a few seconds; the number next to “Log” counts the ones you have not seen here.',
  unread: (count: number) => `${count} unread`,
  empty: 'Nothing has happened yet. Start a chain and its launches will show here.',
  emptyAction: 'To the projects',
  levels: { info: 'Info', warning: 'Warning', error: 'Error' },
  filters: {
    level: 'Level', category: 'Category', project: 'Project',
    allLevels: 'All levels', allCategories: 'All categories', allProjects: 'All projects',
    reset: 'Reset', empty: 'No entries match these filters', emptyAction: 'Reset filters',
  },
  categories: {
    sessions: 'Sessions', chain: 'Chain', questions: 'Questions', main: 'Main and CI',
    limits: 'Accounts and limits', packages: 'Packages', settings: 'Settings', system: 'System',
  },
  today: 'Today',
  fresh: 'new',
}
