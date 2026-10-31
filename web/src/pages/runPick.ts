import type { LabelChange } from '../../../src/tracker/labels.js'
import { runLabelOf, runLabelText } from '../../../src/tracker/model.js'

/** The task card's choice of what its sessions run on; `''` in either field is "as the project says". */
export interface RunPick {
  provider: string
  model: string
}

export interface RunPickView {
  pick: RunPick
  /** The task's run labels as the tracker spells them. */
  labels: string[]
  /** More than one run label: the chain runs the task as its project says, and a save replaces them with one. */
  several: boolean
}

const keyOf = (provider: string, model: string | null) => `${provider}|${model ?? ''}`

/** What the card's selects show for the task's labels. */
export function runPickOf(labels: string[]): RunPickView {
  const runs = labels.filter((label) => runLabelOf(label) !== null)
  const distinct = new Map(runs.map((label) => {
    const run = runLabelOf(label)!
    return [keyOf(run.provider, run.model), run] as const
  }))
  const [only] = distinct.values()
  if (distinct.size !== 1 || only === undefined) return { pick: { provider: '', model: '' }, labels: runs, several: distinct.size > 1 }
  return { pick: { provider: only.provider, model: only.model ?? '' }, labels: runs, several: false }
}

/** The label write that makes the task carry the pick alone: every run label off, one built by `runLabelText` on; `null` — it carries it already. */
export function runPickChange(labels: string[], pick: RunPick): LabelChange | null {
  const remove = labels.filter((label) => runLabelOf(label) !== null)
  const model = pick.model.trim()
  const add = pick.provider === '' ? [] : [runLabelText({ provider: pick.provider, model: model === '' ? null : model })]
  const current = runPickOf(labels)
  const same = !current.several && current.pick.provider === pick.provider && (pick.provider === '' || current.pick.model === model)
  return same ? null : { add, remove }
}
