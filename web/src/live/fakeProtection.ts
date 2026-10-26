import type { EvenKeelState } from '../../../src/state.js'
import { DEFAULT_PROTECTION, PROTECTION_GROUPS } from '../../../src/sessions/protection.js'

export function withProtection(state: EvenKeelState, mode: string): EvenKeelState {
  const disabled = mode === 'unsafe' ? [...PROTECTION_GROUPS] : []
  const protection = { ...DEFAULT_PROTECTION, disabled }
  return {
    ...state,
    config: {
      ...state.config,
      shared: { ...state.config.shared, protection, execution: { ...state.config.shared.execution, codex: 'bypass' } },
      projects: { ...state.config.projects, ABC: { ...state.config.projects.ABC!, provider: 'codex', protection } },
    },
    protection: { ABC: [{ remote: mode === 'unknown' ? 'upstream-with-a-long-name-for-the-shared-repository' : 'origin', branch: 'develop', status: mode === 'protected' ? 'protected' : mode === 'unknown' ? 'unknown' : 'unprotected', bypass: false, url: 'https://github.com/example/demo/settings/rules' }] },
  }
}
