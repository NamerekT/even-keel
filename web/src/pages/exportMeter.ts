import type { ExportStage } from '../../../src/tracker/export.js'

/** The copy's steps in their order (`runExport`): each goes through every task before the next one starts. */
export const EXPORT_STEPS = ['created', 'linked', 'attached', 'journaled', 'marked'] as const satisfies readonly Exclude<ExportStage, 'pending'>[]
export type ExportStep = (typeof EXPORT_STEPS)[number]

/** The import's steps (`runImport`, BTN-1405): the same but the marks, which the source never gets. */
export const IMPORT_STEPS = ['created', 'linked', 'attached', 'journaled'] as const satisfies readonly ExportStep[]
export type ImportStep = (typeof IMPORT_STEPS)[number]

export interface ExportMeter {
  /** The step the copy is at: the first one not every task passed; `null` — every task is through. */
  stage: ExportStep | null
  /** Its place, from 1. */
  step: number
  /** The tasks that passed it. */
  done: number
}

/**
 * What the window's meter shows (BTN-1194): the current step and its count, so the bar moves from the first task on.
 * `steps` — the direction's: the export's five, the import's four.
 */
export function meterOf(progress: Partial<Record<ExportStep, number>>, total: number, steps: readonly ExportStep[] = EXPORT_STEPS): ExportMeter {
  const reached = (stage: ExportStep) => progress[stage] ?? 0
  const index = steps.findIndex((stage) => reached(stage) < total)
  if (index === -1) return { stage: null, step: steps.length, done: reached(steps[steps.length - 1]!) }
  const stage = steps[index]!
  return { stage, step: index + 1, done: reached(stage) }
}
