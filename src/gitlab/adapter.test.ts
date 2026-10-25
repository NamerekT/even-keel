import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sessionBase } from '../agent/env.js'
import { parseConfig } from '../config.js'
import { keysOf, substitute } from '../packages/keys.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { gitlab } from './adapter.js'

describe('GitLab adapter registration', () => {
  it('defaults the server, requires a token when a host is given and builds subgroup issue links', () => {
    expect(ADAPTERS.gitlab).toBe(gitlab)
    expect(gitlab.setup({}, {})).toBeUndefined()
    expect(() => gitlab.setup({ GITLAB_URL: 'https://gitlab.example.com' }, {})).toThrow()
    const setup = gitlab.setup({ GITLAB_TOKEN: 'example' }, { app: { key: 'APP', value: 'group/subgroup/app' } })!
    expect(setup.issueUrl('app')).toBe('https://gitlab.com/group/subgroup/app/-/issues/{number}')
    expect(setup.projectUrl!('app')).toBe('https://gitlab.com/group/subgroup/app/-/issues')
    expect(setup.issueUrl(null)).toBeNull()
  })

  it('validates the project path and the profile URL', () => {
    expect(gitlab.projectKey!.pattern.test('group/subgroup/app')).toBe(true)
    expect(gitlab.projectKey!.pattern.test('../app')).toBe(false)
    expect(() => gitlab.setup({ GITLAB_TOKEN: 'example', GITLAB_URL: 'file:///tmp' }, {})).toThrow()
    expect(() => parseConfig({ projects: [{ key: 'APP', repo: '.', tracker: 'gitlab' }] })).toThrow()
    const config = parseConfig({ projects: [{ id: 'project-id', key: 'APP', repo: '.', tracker: 'gitlab', gitlab: 'group/subgroup/app' }] })
    expect(config.trackerProjects).toEqual({ 'project-id': 'group/subgroup/app' })
    expect(sessionBase({ GITLAB_URL: 'https://gitlab.example.com', GITLAB_TOKEN: 'example', PATH: 'bin' })).toEqual({ PATH: 'bin' })
  })

  it('hands the profile token and default host to the package through gateway substitutions', () => {
    const entry = JSON.parse(readFileSync(new URL('../../plugins/gitlab/.mcp.json', import.meta.url), 'utf8')).mcpServers.gitlab
    const keys = keysOf('gitlab', entry, trackerKeyRules(), { GITLAB_TOKEN: 'example' })
    expect(keys.missing).toEqual([])
    expect(substitute(entry, keys.values)).toMatchObject({ env: { GITLAB_PERSONAL_ACCESS_TOKEN: 'example', GITLAB_API_URL: 'https://gitlab.com' } })
    const own = keysOf('gitlab', entry, trackerKeyRules(), { GITLAB_TOKEN: 'example', GITLAB_URL: 'https://gitlab.example.com/prefix/' })
    expect(substitute(entry, own.values)).toMatchObject({ env: { GITLAB_API_URL: 'https://gitlab.example.com/prefix/' } })
  })
})
