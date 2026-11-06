import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRemote } from '../ci/remote.js'
import { parseConfig } from '../config.js'
import { keysOf, substitute } from '../packages/keys.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { forgejo } from './adapter.js'

const VALUES = { FORGEJO_URL: 'git.example.com/', FORGEJO_TOKEN: 'example-token' }

describe('Forgejo adapter registration', () => {
  it('is a tracker with projects, named by its host', () => {
    expect(ADAPTERS.forgejo).toBe(forgejo)
    expect(forgejo.projects).toBeTypeOf('function')
    expect(forgejo.profileName(VALUES, null)).toBe('Forgejo · git.example.com')
  })

  it('wants the address and the token together, and an address that is one', () => {
    expect(forgejo.setup({}, {})).toBeUndefined()
    expect(() => forgejo.setup({ FORGEJO_TOKEN: 'example-token' }, {})).toThrow('go together')
    expect(() => forgejo.setup({ FORGEJO_URL: 'https://git.example.com' }, {})).toThrow('go together')
    expect(() => forgejo.setup({ FORGEJO_URL: 'http://', FORGEJO_TOKEN: 'example-token' }, {})).toThrow('not an address')
  })

  it('links the issues of the project\'s repository on the profile\'s server', () => {
    const setup = forgejo.setup(VALUES, { app: { key: 'APP', value: 'example-org/app' } })!
    expect(setup.issueUrl('app')).toBe('https://git.example.com/example-org/app/issues/{number}')
    expect(setup.projectUrl!('app')).toBe('https://git.example.com/example-org/app/issues')
    expect(setup.issueUrl(null)).toBeNull()
    expect(setup.issueUrl('other')).toBeNull()
    const prefixed = forgejo.setup({ ...VALUES, FORGEJO_URL: 'https://example.com/git/' }, { app: { key: 'APP', value: 'example-org/app' } })!
    expect(prefixed.issueUrl('app')).toBe('https://example.com/git/example-org/app/issues/{number}')
  })

  it('takes an owner/name repository for the project', () => {
    expect(forgejo.projectKey!.pattern.test('example-org/app.web')).toBe(true)
    expect(forgejo.projectKey!.pattern.test('group/subgroup/app')).toBe(false)
    expect(forgejo.projectKey!.pattern.test('app')).toBe(false)
    expect(() => parseConfig({ projects: [{ key: 'APP', repo: '.', tracker: 'forgejo' }] })).toThrow()
    const config = parseConfig({ projects: [{ id: 'project-id', key: 'APP', repo: '.', tracker: 'forgejo', forgejo: 'example-org/app' }] })
    expect(config.trackerProjects).toEqual({ 'project-id': 'example-org/app' })
  })

  it('hands the token and the address with its scheme to gitea-mcp through gateway substitutions', () => {
    const entry = JSON.parse(readFileSync(new URL('../../plugins/forgejo/.mcp.json', import.meta.url), 'utf8')).mcpServers.forgejo
    const keys = keysOf('forgejo', entry, trackerKeyRules(), VALUES)
    expect(keys.missing).toEqual([])
    expect(substitute(entry, keys.values)).toMatchObject({ env: { GITEA_ACCESS_TOKEN: 'example-token', GITEA_HOST: 'https://git.example.com' } })
  })
})

describe('forgejo.projectOfRemote', () => {
  const suggest = (url: string, env: Record<string, string | undefined> = VALUES) => forgejo.projectOfRemote!(parseRemote(url)!, url, env)

  it('takes owner/name of a remote on the profile\'s host, by https or ssh, under a prefix too', () => {
    expect(suggest('https://git.example.com/example-org/app.git')).toBe('example-org/app')
    expect(suggest('git@git.example.com:example-org/app.git')).toBe('example-org/app')
    expect(suggest('https://GIT.example.com/git/example-org/app')).toBe('example-org/app')
  })

  it('takes no remote of another host or without a profile', () => {
    expect(suggest('https://codeberg.org/example-org/app.git')).toBeUndefined()
    expect(suggest('https://git.example.com/example-org/app.git', {})).toBeUndefined()
  })
})
