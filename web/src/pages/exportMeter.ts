import type { ExportStage, ExportState } from '../../../src/tracker/export.js'

/** The copy's steps in their order (`runExport`): each goes through every task before the next one starts. */
export const EXPORT_STEPS = ['created', 'linked', 'attached', 'journaled', 'marked'] as const satisfies readonly Exclude<ExportStage, 'pending'>[]
export type ExportStep = (typeof EXPORT_STEPS)[number]

export interface ExportMeter {
  /** The step the copy is at: the first one not every task passed; `null` — every task is through. */
  stage: ExportStep | null
  /** Its place, from 1. */
  step: number
  /** The tasks that passed it. */
  done: number
}

/** What the window's meter shows (BTN-1194): the current step and its count, so the bar moves from the first task on. */
export function meterOf(progress: ExportState['progress'], total: number): ExportMeter {
  const index = EXPORT_STEPS.findIndex((stage) => progress[stage] < total)
  if (index === -1) return { stage: null, step: EXPORT_STEPS.length, done: progress.marked }
  const stage = EXPORT_STEPS[index]!
  return { stage, step: index + 1, done: progress[stage] }
}
