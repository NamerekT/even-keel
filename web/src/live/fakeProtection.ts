import type { EvenKeelState } from '../../../src/state.js'
import type { RemoteProtection } from '../../../src/ci/protection-model.js'
import { DEFAULT_PROTECTION, PROTECTION_GROUPS } from '../../../src/sessions/protection.js'

export function withProtection(state: EvenKeelState, mode: string): EvenKeelState {
  const openCode = mode.startsWith('opencode')
  const disabled = mode === 'unsafe' || mode === 'opencodeUnsafe' || mode === 'opencodeCustom' ? [...PROTECTION_GROUPS] : []
  const protection = { ...DEFAULT_PROTECTION, disabled, opencode: mode === 'opencodeCustom' ? ['git reset --hard*'] : [] }
  return {
    ...state,
    config: {
      ...state.config,
      shared: { ...state.config.shared, protection, execution: { ...state.config.shared.execution, codex: 'bypass' } },
      projects: { ...state.config.projects, ABC: { ...state.config.projects.ABC!, provider: openCode ? 'opencode' : 'codex', protection } },
    },
    protection: { ABC: mode === 'twoRemotes' ? TWO_REMOTES : [{ remote: mode === 'unknown' ? 'upstream-with-a-long-name-for-the-shared-repository' : 'origin', branch: 'develop', status: mode === 'protected' || openCode ? 'protected' : mode === 'unknown' ? 'unknown' : 'unprotected', bypass: false, url: 'https://github.com/example/demo/settings/rules' }] },
  }
}

/** `?protection=twoRemotes`: the same branch unprotected on both remotes, one band (BTN-759). */
const TWO_REMOTES: RemoteProtection[] = [
  { remote: 'origin', branch: 'release/v0.2', status: 'unprotected', bypass: false, url: 'https://git.example.com/example/demo/settings/branches' },
  { remote: 'github', branch: 'release/v0.2', status: 'unprotected', bypass: false, url: 'https://github.com/example/demo/settings/rules' },
]
