import { joinLabels, type Ask, type AskAnswers, type AskQuestion } from '../../../src/sessions/ask.js'

/** What the user has picked for one question: option labels, whether "Other" is on, and its text (kept while it is off). */
export interface Pick {
  labels: string[]
  otherOn: boolean
  other: string
}

export const NO_PICK: Pick = { labels: [], otherOn: false, other: '' }

/** The answer the CLI would record for a pick: one label, the "Other" text, or the labels joined for a multi-select. */
export function pickAnswer(question: AskQuestion, pick: Pick): string {
  const other = pick.otherOn ? pick.other.trim() : ''
  if (!question.multiSelect) return other !== '' ? other : (pick.labels[0] ?? '')
  return joinLabels(other === '' ? pick.labels : [...pick.labels, other])
}

export function askAnswers(ask: Ask, picks: Pick[]): AskAnswers {
  return Object.fromEntries(ask.questions.map((question, index) => [question.question, pickAnswer(question, picks[index] ?? NO_PICK)]))
}

/** A permission ask answered by one of its buttons: its only question gets the option's label. */
export function permissionAnswer(ask: Ask, label: string): AskAnswers {
  return { [ask.questions[0]!.question]: label }
}

/**
 * What the preview column shows: `undefined` — no column, as no option has a preview; `null` — the column stays, empty,
 * for an option without one, so pointing at it never reflows the options under the pointer (EKR-139). The pointed
 * option wins, then the picked one, then the first with a preview.
 */
export function shownPreview(question: AskQuestion, pointed: string | null, picked: string[]): string | null | undefined {
  const first = question.options.find((option) => option.preview !== undefined)
  if (first === undefined) return undefined
  const shown = question.options.find((option) => option.label === pointed) ?? question.options.find((option) => picked.includes(option.label))
  return (shown ?? first).preview ?? null
}

export function chooseLabel(question: AskQuestion, pick: Pick, label: string, on: boolean): Pick {
  if (!question.multiSelect) return { ...pick, labels: [label], otherOn: false }
  return { ...pick, labels: on ? [...pick.labels, label] : pick.labels.filter((each) => each !== label) }
}

export function toggleOther(question: AskQuestion, pick: Pick, on: boolean): Pick {
  return { ...pick, labels: question.multiSelect ? pick.labels : [], otherOn: on }
}

export function typeOther(pick: Pick, other: string): Pick {
  return { ...pick, other }
}
