import { describe, expect, it } from 'vitest'
import type { CliCopyView } from '../../../src/agent/cli-state.js'
import { cliLine, repositoryUrl, reportLinks } from './reportLinks.js'

const copy = (over: Partial<CliCopyView>): CliCopyView => ({
  version: '2.0.0', source: 'system', status: 'missing', checkedStatus: 'missing', installable: true, system: true, installed: '2.1.0',
  received: 0, total: 0, approximate: 0, ...over,
})

const params = (url: string) => Object.fromEntries(new URL(url).searchParams)

describe('repositoryUrl', () => {
  it('takes the address out of the git url of package.json', () => {
    expect(repositoryUrl('git+https://github.com/example/app.git')).toBe('https://github.com/example/app')
    expect(repositoryUrl('https://github.com/example/app')).toBe('https://github.com/example/app')
  })
})

describe('cliLine', () => {
  it('names each agent with the version its sessions run, the default provider first', () => {
    const copies = { claude: copy({ installed: '2.1.0' }), codex: copy({ source: 'checked', status: 'ready', version: '0.9.0', installed: '0.8.0' }) }
    expect(cliLine(copies, 'codex')).toBe('Codex 0.9.0, Claude Code 2.1.0')
  })

  it('takes the newest copy on latest and the installed CLI while a copy is not ready', () => {
    expect(cliLine({ claude: copy({ source: 'latest', status: 'ready', latest: '2.2.0' }) }, 'claude')).toBe('Claude Code 2.2.0')
    expect(cliLine({ claude: copy({ source: 'checked', status: 'downloading', installed: '2.1.0' }) }, 'claude')).toBe('Claude Code 2.1.0')
  })

  it('leaves out an agent with no version and is empty without any', () => {
    expect(cliLine({ claude: copy({}), copilot: copy({ system: false, installed: null }) }, 'claude')).toBe('Claude Code 2.1.0')
    expect(cliLine(undefined, 'claude')).toBe('')
  })
})

describe('reportLinks', () => {
  const links = reportLinks({ repository: 'https://github.com/example/app', version: '0.3.4', cli: 'Claude Code 2.1.0' })

  it('fills the version and the CLI into each form by its field ids', () => {
    expect(links.bug.startsWith('https://github.com/example/app/issues/new?')).toBe(true)
    expect(params(links.bug)).toEqual({ template: 'bug.yml', version: '0.3.4', cli: 'Claude Code 2.1.0' })
    expect(params(links.cliUpdate)).toEqual({ template: 'cli-update.yml', version: '0.3.4', 'cli-now': 'Claude Code 2.1.0' })
    expect(params(links.setup)).toEqual({ template: 'setup.yml' })
  })

  it('sends no empty field', () => {
    expect(params(reportLinks({ repository: 'https://github.com/example/app', version: '0.3.4', cli: '' }).bug)).toEqual({ template: 'bug.yml', version: '0.3.4' })
  })

  it('leads a question to the discussions and a vulnerability to a private advisory', () => {
    expect(links.discussions).toBe('https://github.com/example/app/discussions/new/choose')
    expect(links.security).toBe('https://github.com/example/app/security/advisories/new')
  })
})
