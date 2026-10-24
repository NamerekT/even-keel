import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { CliVersionView } from '../../../src/state.js'
import { setLanguage } from '../i18n/index.js'
import { cliSummary } from './cliVersions.js'

const unchecked = (agent: string, title: string, installed: string, checked: string): CliVersionView => ({
  agent,
  account: null,
  installed,
  checked,
  notice: notice('agent.uncheckedVersion', { title, installed, checked }),
})
const daemon: CliVersionView = {
  agent: 'claude',
  account: 'global',
  installed: '2.1.303',
  checked: '2.1.301',
  notice: notice('agent.daemonVersion', { title: 'Claude Code', account: 'global', running: '2.1.303', wanted: '2.1.301' }),
}

describe('cliSummary', () => {
  it('names the one CLI and its versions', () => {
    setLanguage('en')
    expect(cliSummary([unchecked('claude', 'Claude Code', '2.1.309', '2.1.310')])).toBe('Claude Code 2.1.309 · checked 2.1.310')
  })

  it('names the account of a daemon', () => {
    setLanguage('en')
    expect(cliSummary([daemon])).toBe('The Claude Code daemon of global runs 2.1.303 · checked 2.1.301')
  })

  it('counts several', () => {
    setLanguage('en')
    expect(cliSummary([unchecked('claude', 'Claude Code', '2.1.309', '2.1.310'), daemon])).toBe('2 CLIs on versions Even Keel was not checked against')
  })

  it('speaks Russian', () => {
    setLanguage('ru')
    expect(cliSummary([unchecked('codex', 'Codex', '0.163.0', '0.162.1')])).toBe('Codex 0.163.0 · проверен 0.162.1')
    expect(cliSummary([daemon])).toBe('Демон Claude Code аккаунта global на 2.1.303 · проверен 2.1.301')
    const five = ['a', 'b', 'c', 'd', 'e'].map((agent) => unchecked(agent, agent, '2', '1'))
    expect(cliSummary(five)).toBe('5 CLI на версиях, на которых Even Keel не проверяли')
  })
})
