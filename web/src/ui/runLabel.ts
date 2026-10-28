import { runLabelOf } from '../../../src/tracker/model.js'

export function runLabelView(label: string): { provider: string; model: string | null } | null {
  const run = runLabelOf(label)
  if (run === null) return null
  return { provider: label.split('|')[0]!.trim(), model: run.model?.slice(run.model.lastIndexOf('/') + 1) ?? null }
}
