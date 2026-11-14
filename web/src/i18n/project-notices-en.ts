import { plural } from './plural.js'

const counted = (one: string, other: string) => (count: number) => `${count} ${plural('en', count, { one, other })}`

export const projectNoticesEn = {
  warnings: counted('warning', 'warnings'),
  cleanupSummary: (tasks: string) => `Cleanup: ${tasks}`,
  dismissAll: 'Done for all',
  leftover: (task: string) => `${task} is closed, but not everything after it went through — check by hand.`,
  dismiss: 'Done',
  forwardWaits: (count: number, into: string) =>
    `${counted('commit', 'commits')(count)} of this project ${count === 1 ? 'waits' : 'wait'} to go into ${into}.`,
  forwardPushFailed: (into: string) => `The release branch went into ${into}, but its push failed; the next sync pushes it.`,
  forwardNow: 'Carry now',
  forwardConflict: (count: number, from: string, into: string, files: number) =>
    `${counted('commit', 'commits')(count)} of ${from} conflict${count === 1 ? 's' : ''} with ${into} in ${counted('file', 'files')(files)}`,
  forwardResolve: 'Resolve with the agent',
  forwardMore: 'Details',
  forwardAgent: (into: string) => `The agent resolves the conflict in the chain of ${into}`,
  forwardAgentAsked: (into: string) => `The agent resolves the conflict after the current task of ${into}`,
  forwardAgentOpen: 'Open',
  openToAll: (place: string) =>
    `The repository ${place} is public: anyone can open an issue there. An issue of someone outside the repository waits in the backlog until you press "Into the chain" on it; ` +
    'the issues of its members enter the chain at once. To decide on each issue yourself, pick "Only with a required label" in the rules of this source and name the label.',
  openToAllRules: 'Rules',
  templateRequiredLabel: (label: string, templates: string[], place: string) =>
    `The issue ${templates.length === 1 ? 'template' : 'templates'} ${templates.join(', ')} of ${place} ${templates.length === 1 ? 'puts' : 'put'} the label "${label}" on for any author, ` +
    `and "${label}" is a label the tasks of this source need to enter the chain: anyone's issue opened from ${templates.length === 1 ? 'it' : 'them'} enters at once. ` +
    'Take the label out of the template, or name another one in the rules of this source.',
  templateIntakeLabel: (label: string, templates: string[]) =>
    `The issue ${templates.length === 1 ? 'template' : 'templates'} ${templates.join(', ')} ${templates.length === 1 ? 'puts' : 'put'} the label "${label}" on for any author, ` +
    `and Even Keel takes issues with "${label}" into the tracker: anyone's issue opened from ${templates.length === 1 ? 'it' : 'them'} becomes a task at once. ` +
    'Take the label out of the template, or pick another label for taking issues in.',
  templateLabelSettings: 'Settings',
}
