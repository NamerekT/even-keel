import type { NoticeParams, NoticeTexts } from '../../../src/notice/notice.js'

const list = (items: string[]) => items.join(', ')

/**
 * The refusals of a setting as its field says them (BTN-297): the field stands next to the text, so it speaks of the
 * value and names other fields by their labels, never by a path of the config. The log and `config-import` keep the
 * server's text with the path.
 */
export const fieldsEn = {
  'config.branch': (p) => `${p.value} is not a branch name`,
  'config.changelogPath': (p) => `${p.value} is not a file path inside the repository`,
  'config.repoEmpty': () => 'The folder of the repository is empty',
  'config.slot': () => 'Off, on, or a whole number of slots from 1',
  'config.color': () => 'A color from 1 to 8',
  'config.ruleList': () => 'Every line needs a name',
  'config.projectPrompt': () => 'Must be text',
  'config.projectName': () => 'Must be text',
  'config.providerName': () => 'Must be text',
  'config.commandList': () => 'One command per line',
  'config.ciWait': () => 'A whole number of minutes, 0 or more, or empty',
  'config.ciKinds': (p) => `Only ${list(p.known)}`,
  'config.remoteProfiles': () => 'Pick a profile for each kind of remote',
  'config.standards': () => 'Each standard needs a document inside the repository and at least one file mask; a document only once',
  'config.mergeIntoValue': () => 'Pick a project or none',
  'config.mergeInto': (p) => `${p.into} is not another project or merges into one itself: a project merges only into one that merges nowhere`,
  'config.mergeIntoForeign': (p) => `${p.into} is a checkout of another repository: they share no remote, and neither is a clone of the other`,
  'config.statusBoth': (p) => `"${p.status}" is in both "Statuses in work" and "Closed statuses"`,
  'config.labelBoth': (p) => `"${p.label}" is in both "Only tasks with labels" and "No tasks with labels"`,
  'config.milestoneBoth': (p) => `"${p.milestone}" is in both "Only tasks in milestones" and "No tasks in milestones"`,
  'config.trackerProjectShared': (p) =>
    `${p.other} reads the tracker project ${p.trackerProject} too, and a task may enter both chains: split them by "Only tasks in milestones" and "No tasks in milestones"`,
  'config.trackerLocked': () => 'The chain has started tasks of this project, so its tracker and profile stay; tasks of another tracker come in through "Task feeds"',
  'config.trackerName': () => 'Pick a tracker',
  'config.trackerUnknown': (p) => `There is no tracker "${p.name}", there are ${list(p.known)}`,
  'config.trackerProject': (p) => `Name the project in the tracker like ${p.example}`,
  'config.brief': () => 'On or off',
  'config.briefValue': () => 'On, off or as the shared settings',
  'config.language': (p) => `There is no language ${p.value}`,
  'config.provider': (p) => `There is no provider ${p.value}`,
  'config.execution': (p) => `There is no mode ${p.value}`,
  'config.cli': (p) => `There is no choice ${p.value}`,
  'config.checkpointShare': (p) => `A whole percent of the context window, 1 to 100, not ${p.value}`,
  'config.checkpointShareOrder': (p) => `First < Late < Hard, not ${p.first}, ${p.late}, ${p.hard}`,
  'config.modelPrompts': () => 'A prompt per model',
  'config.modelPromptEmpty': (p) => `The prompt of ${p.model} is empty`,
  'config.modelPromptPlaceholder': (p) => `The prompt of ${p.model} has ${p.placeholder}, but a model prompt goes to the session as it is, without substitutions`,
  'config.hiddenSkills': () => 'A skill name per line',
  'config.cacheTtl': () => '5 min, 1 h, or empty',
  'config.parallel': (p) => `A whole number from 1, not ${p.value}`,
  'config.keepWarm': (p) => `Whole hours from 0 to ${p.max}, not ${p.value}`,
  'config.allowedHosts': () => 'A host name per line',
  'config.contextWindow': (p) => `A whole number of tokens from 1, not ${p.value}`,
  'config.contextPercents': () => 'Percents with 0 < Warning < Danger ≤ 100',
  'config.compareValue': (p) => `A whole number from 1 to ${p.limit}, not ${p.value}`,
  'config.statsMove': () => 'A moved folder needs both its old and its new path',
  'config.otherBelow': (p) => `A number of dollars from 0, not ${p.value}`,
  'config.checkpointTokens': (p) => `A whole number of tokens from ${p.from}, or empty, not ${p.value}`,
} satisfies Partial<NoticeTexts>

export type FieldCode = keyof typeof fieldsEn
export type FieldTexts = { [K in FieldCode]: (params: NoticeParams<K>) => string }
