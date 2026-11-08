import { runLabelOf } from '../../../src/tracker/model.js'

/** The model without its route: `openrouter/minimax/minimax-m3.1-flash` → `minimax-m3.1-flash`. */
export function modelName(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1)
}

export function runLabelView(label: string): { provider: string; model: string | null } | null {
  const run = runLabelOf(label)
  if (run === null) return null
  return { provider: label.split('|')[0]!.trim(), model: run.model === null || run.model === undefined ? null : modelName(run.model) }
}
