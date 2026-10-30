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
