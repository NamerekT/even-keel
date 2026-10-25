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
}
