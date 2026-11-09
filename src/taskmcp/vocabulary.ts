import { isActive, sameName, type ChainRules } from '../chain/rules.js'
import { EditRefused, type TaskEditor } from '../tracker/editor.js'
import { QUESTION_LABELS } from '../tracker/model.js'
import type { Tracker, TrackerVocabulary } from '../tracker/source.js'

/**
 * What an agent needs to know of a tracker before it picks a name (BTN-893): its vocabulary, the chain rules its tasks
 * are judged by and the fields it keeps. `known` is `null` for a tracker that gives no vocabulary.
 */
export interface TrackerTerms {
  known: TrackerVocabulary | null
  rules: ChainRules
  priority: boolean
  estimate: boolean
  /** The tracker's components (BTN-895); `null` — it keeps none. */
  components: string[] | null
  /** The tracker takes files. */
  attachments: boolean
  /** The tracker keeps blocking links (BTN-927): GitLab Free does not. */
  blocking: boolean
}

/** The tracker's terms for the reader; a failed vocabulary read throws. */
export async function termsOf(tracker: Tracker, reader: string, rules: ChainRules): Promise<TrackerTerms> {
  const [known, blocking] = await Promise.all([
    tracker.vocabulary === undefined ? null : tracker.vocabulary(reader),
    tracker.editor?.blockingLinks === undefined ? true : tracker.editor.blockingLinks(),
  ])
  return { known, rules, blocking, ...fieldsOf(tracker.editor, known) }
}

type Fields = Pick<TrackerTerms, 'priority' | 'estimate' | 'components' | 'attachments'>

function fieldsOf(editor: TaskEditor | undefined, known: TrackerVocabulary | null): Fields {
  const labels = known?.labels ?? []
  return {
    priority: editor?.priorities?.(labels) ?? true,
    estimate: editor?.estimate !== undefined && known?.estimate !== false,
    components: editor?.components === true ? (known?.components ?? []) : null,
    attachments: editor?.files !== undefined,
  }
}

const list = (names: string[]) => (names.length === 0 ? 'none' : names.join(', '))

/** The tracker's own spelling of each name it has, in the order given. */
const spelled = (names: string[], labels: string[]) => names.flatMap((name) => labels.find((each) => sameName(each, name)) ?? [])

/**
 * The line of the chain's roles, e.g. `chain: into it — Todo; skip — Manual; question — Question; milestones v0.3;
 * priority: yes; estimate: no`, then `blocking links: no` where the tracker keeps none, the components where it keeps
 * them and `attachments: no` where it takes no files. `full: false` leaves the milestones out: the line of another tracker than the task's.
 */
export function rolesLine(terms: TrackerTerms, full = true): string {
  const { known, rules } = terms
  if (known === null) return 'chain: this tracker gives no vocabulary; set no status, label or milestone through these tools'
  const active = known.statuses.filter((status) => isActive(rules, status))
  const waiting = active.filter((status) => status.category === 'ToDo')
  const into = (waiting.length > 0 ? waiting : active).map((status) => status.name)
  const required = spelled(rules.requiredLabels, known.labels)
  const intoText = into.length === 0 ? 'none' : `${into.join(' or ')}${required.length === 0 ? '' : ` with the label ${required.join(' or ')}`}`
  const parts = [
    `chain: into it — ${intoText}`,
    `skip — ${list(spelled(rules.excludedLabels, known.labels))}`,
    `question — ${list(spelled(QUESTION_LABELS, known.labels))}`,
  ]
  if (full) {
    const milestones = known.milestones ?? []
    parts.push(milestones.length === 0 ? 'no milestones' : `milestones ${milestones.join(', ')}`)
  }
  parts.push(`priority: ${terms.priority ? 'yes' : 'no'}`, `estimate: ${terms.estimate ? 'yes' : 'no'}`)
  if (!terms.blocking) parts.push('blocking links: no')
  if (terms.components !== null) parts.push(`components: ${list(terms.components)}`)
  if (!terms.attachments) parts.push('attachments: no')
  return parts.join('; ')
}

/** The tracker's vocabulary for a name the agent gives: a tracker without one refuses it honestly. */
export function vocabularyFor(terms: TrackerTerms): TrackerVocabulary {
  if (terms.known === null) throw new EditRefused('this tracker gives no vocabulary: these tools cannot set a status, a label or a milestone on it')
  return terms.known
}

/** A tracker of a project as a session's prompt names it. */
export interface PromptTracker {
  prefix: string
  title: string
  /** `null` — its terms were not read (the tracker is off or did not answer): it gets no roles line. */
  terms: TrackerTerms | null
}

/**
 * The lines of a session's prompt about its project's trackers: the roles line of the task's tracker, and, with feeds,
 * the list of the trackers and a short roles line of each other one. Empty — nothing was read.
 */
export function promptLines(trackers: PromptTracker[], own: string): string[] {
  const mine = trackers.find((each) => each.prefix === own)
  if (trackers.length <= 1) return mine?.terms == null ? [] : [rolesLine(mine.terms)]
  const lines = [`trackers: ${trackers.map((each) => `${each.prefix} — ${each.title}${each.prefix === own ? ' (this task)' : ''}`).join(', ')}`]
  for (const each of trackers) if (each.terms !== null) lines.push(`${each.prefix} ${rolesLine(each.terms, each.prefix === own)}`)
  return lines
}
