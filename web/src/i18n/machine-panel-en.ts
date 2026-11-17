import type { Messages } from './ru.js'

export const machinePanelEn: Messages['machinePanel'] = {
  title: 'Machines',
  block: (count) => `Machines: ${count}. The chain by machine`,
  blockOne: (name) => `The view of "${name}"`,
  all: 'All machines',
  allLine: "the project's whole chain",
  next: 'next:',
  limit: (time) => `accounts at a limit till ${time}`,
  git: 'git: no name or e-mail',
  packages: "the project's packages are not ready",
  offline: (span) => `off the link for ${span}`,
  offlineUnknown: 'off the link',
  idle: 'no task for it',
  page: (name) => `The page of "${name}"`,
  add: '+ Machine',
  lampHead: "The machine's lamp",
  lamps: {
    working: 'Online and working: its task is under the name.',
    free: 'Online and free: it takes the next task it can.',
    limit: 'Every account it has for this project is at a limit: it waits for the reset.',
    blocked: 'Git on the machine is not ready: it takes no task of this project until you fix it.',
    offline: 'Off the link with the hub; the card is faded. Under the name — how long it has been off.',
  },
  cardHead: 'The card',
  cardSigns: {
    stripe: "The machine's colour. The header's button, the tags on tasks and the strip under the header have it too. It is changed on the machine's page.",
    selected: 'The view chosen: the chain and the backlog are shown for this machine.',
    next: '"next" is the task it would take by a guess, not a promise: a machine takes a task itself once it is free.',
    page: "The machine's page: link and version, colour, capacity, projects, accounts, packages, sessions, disconnect.",
    all: '"All machines" is the project\'s whole chain, unfiltered.',
  },
}
