import type { ChainControl, ChainControls } from '../state.js'

/**
 * What the chain's hotkey presses: the head's "Start" on an idle chain, "Resume" on a paused one; `null` on a running,
 * queued or empty one — the key never stops or restarts a chain.
 */
export function chainRunControl(controls: ChainControls): Extract<ChainControl, 'start' | 'resume'> | null {
  if (controls.enabled.includes('resume')) return 'resume'
  if (controls.enabled.includes('start')) return 'start'
  return null
}
