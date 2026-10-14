import type { EvenKeelState } from '../../../src/state.js'
import type { UpdatesView } from '../../../src/updates/release.js'

const INSTALLED = '0.1.0'

/** `?update=<version>`: a newer release with its toast; without it — none. */
export function fakeUpdates(version: string | null): UpdatesView {
  if (version === null || version === '') return { current: INSTALLED, available: null, toast: false }
  return { current: INSTALLED, available: { version, url: `https://github.com/example/even-keel/releases/tag/v${version}` }, toast: true }
}

/** The toast's buttons; `null` for another command. */
export function fakeUpdatesCommand(state: EvenKeelState, name: string): EvenKeelState | null {
  if (name === 'updates/dismiss') return { ...state, updates: { ...state.updates, toast: false } }
  if (name !== 'updates/mute') return null
  const shared = { ...state.config.shared, updates: { ...state.config.shared.updates, notify: false } }
  return { ...state, updates: { ...state.updates, toast: false }, config: { ...state.config, shared } }
}
