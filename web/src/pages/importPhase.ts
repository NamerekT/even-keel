import type { ImportState } from '../../../src/tracker/import-plan.js'

export type ImportPhase = 'read' | 'pick' | 'running' | 'resume' | 'finished' | 'switching'

/**
 * The step the import window stands at (BTN-1406): its plan while no import began, the meter while one runs, "Continue"
 * for one that stopped short — failed, or lost to a restart — and the check with the switch once every task is through;
 * then the switch's own meter while it goes (BTN-1432).
 */
export function importPhaseOf(state: ImportState | null): ImportPhase {
  if (state === null) return 'read'
  if (state.switching !== null) return 'switching'
  if (state.running) return 'running'
  if (state.from === null) return 'pick'
  const through = state.failed === null && state.finishedAt !== null && state.progress.done >= state.total
  return through ? 'finished' : 'resume'
}
