import { PROVIDERS } from '../../../src/agent/providers.js'
import type { CliCopyView } from '../../../src/agent/cli-state.js'
import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

const VERSIONS: Record<string, string> = { claude: '2.1.310', codex: '0.164.0', opencode: '1.18.25', copilot: '1.0.98' }
const SIZES: Record<string, number> = { claude: 280, codex: 440, opencode: 170, copilot: 155 }

export function withCliCopies(state: EvenKeelState, params: URLSearchParams): EvenKeelState {
  const mode = params.get('copies')
  if (!mode) return state
  const provider = params.get('copyAgent') ?? 'claude'
  const cliCopies = Object.fromEntries(PROVIDERS.map((agent): [string, CliCopyView] => [agent, {
    version: VERSIONS[agent]!, source: 'checked', status: 'ready', system: true, received: 0, total: 0, approximate: SIZES[agent]! * 1_000_000,
  }]))
  const copy = cliCopies[provider]
  if (!copy) return state
  copy.status = mode === 'downloading' ? 'downloading' : mode === 'failed' ? 'failed' : mode === 'ready' ? 'ready' : 'missing'
  copy.source = mode === 'failed' || mode === 'system-missing' ? 'system' : 'checked'
  copy.system = mode !== 'system-missing' && params.get('copySystem') !== 'missing'
  copy.received = mode === 'downloading' ? 96_000_000 : 0
  copy.total = mode === 'downloading' ? copy.approximate : 0
  const next = { ...state, cliCopies, config: { ...state.config, shared: { ...state.config.shared, cli: { ...state.config.shared.cli, [provider]: copy.source } } } }
  const blocked = copy.source === 'checked' && copy.status !== 'ready'
  return {
    ...next,
    account: { ...next.account, missing: copy.source === 'checked' && copy.status === 'ready' || copy.system ? next.account.missing.filter((agent) => agent !== provider) : [...new Set([...next.account.missing, provider])] },
    chain: { ...next.chain, active: next.chain.active.map((chain, index) => index === 0 && blocked ? { ...chain, current: null, paused: true, error: notice('agent.copyMissing', { title: provider, agent: provider }) } : chain) },
  }
}

export function fakeCliCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (!name.startsWith('cli/')) return null
  if (name === 'cli/check') return state
  const agent = String(body.agent)
  const copy = state.cliCopies?.[agent]
  if (!copy) throw new Error('Unknown agent')
  const source = name === 'cli/system' ? 'system' : 'checked'
  const status = name === 'cli/download' ? 'downloading' : copy.status
  return { ...state,
    cliCopies: { ...state.cliCopies, [agent]: { ...copy, source, status, received: status === 'downloading' ? 24_000_000 : 0, total: status === 'downloading' ? copy.approximate : 0 } },
    config: { ...state.config, shared: { ...state.config.shared, cli: { ...state.config.shared.cli, [agent]: source } } },
  }
}

export function syncFakeCliSources(state: EvenKeelState): EvenKeelState {
  if (!state.cliCopies) return state
  return { ...state, cliCopies: Object.fromEntries(Object.entries(state.cliCopies).map(([agent, copy]): [string, CliCopyView] => [agent, { ...copy, source: state.config.shared.cli[agent] === 'system' ? 'system' : 'checked' }])) }
}

export function finishFakeCli(state: EvenKeelState, agent: string): EvenKeelState {
  const copy = state.cliCopies?.[agent]
  if (!copy || copy.status !== 'downloading') return state
  return { ...state,
    cliCopies: { ...state.cliCopies, [agent]: { ...copy, status: 'ready', received: copy.total } },
    account: { ...state.account, missing: state.account.missing.filter((entry) => entry !== agent) },
    chain: { ...state.chain, active: state.chain.active.map((chain) => chain.error?.code === 'agent.copyMissing' && chain.error.params.agent === agent ? { ...chain, paused: false, error: null } : chain) },
  }
}
