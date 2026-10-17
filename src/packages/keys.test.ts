import { describe, expect, it } from 'vitest'
import { applySettings, defaultSettings, envLine, keysOf, placeholders, substitute, upsertEnv } from './keys.js'

const github = { type: 'http', url: 'https://api.example.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}', 'X-MCP-Toolsets': 'issues,labels' } }
const huly = { command: 'node', args: ['C:\\cache\\huly\\index.cjs'], env: { TOOLSETS: 'issues,projects' } }

describe('placeholders', () => {
  it('names every ${…} of the entry once', () => {
    expect(placeholders({ ...github, env: { A: '${GITHUB_PERSONAL_ACCESS_TOKEN}', B: '${OTHER}' } })).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN', 'OTHER'])
    expect(placeholders(huly)).toEqual([])
  })

  it('names a ${…:-default} too', () => {
    expect(placeholders({ type: 'http', url: '${BASE_URL}/mcp', headers: { Authorization: 'Bearer ${TOKEN:-}' } })).toEqual(['BASE_URL', 'TOKEN'])
  })
})

describe('keysOf', () => {
  it('takes a placeholder from the pool under the name the tracker adapter gives it', () => {
    const keys = keysOf('github', github, { aliases: { GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_TOKEN' }, trackers: [] }, { GITHUB_TOKEN: 'ghp_example' })
    expect(keys).toEqual({ values: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' }, env: {}, missing: [], names: ['GITHUB_TOKEN'] })
  })

  it('reports a placeholder no variable fills', () => {
    expect(keysOf('github', github, { aliases: {}, trackers: [] }, {}).missing).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN'])
  })

  it('gives the stdio server of a tracker the adapter variables that are set, and misses them when the adapter cannot start', () => {
    const tracker = { server: 'huly', variables: ['HULY_URL', 'HULY_TOKEN', 'HULY_EMAIL'], ready: (env: NodeJS.ProcessEnv) => env.HULY_URL !== undefined }
    const set = keysOf('huly', huly, { aliases: {}, trackers: [tracker] }, { HULY_URL: 'https://huly.example.com', HULY_TOKEN: 't' })
    expect(set).toEqual({ values: {}, env: { HULY_URL: 'https://huly.example.com', HULY_TOKEN: 't' }, missing: [], names: ['HULY_URL', 'HULY_TOKEN', 'HULY_EMAIL'] })
    expect(keysOf('huly', huly, { aliases: {}, trackers: [tracker] }, {}).missing).toEqual(['HULY_URL', 'HULY_TOKEN', 'HULY_EMAIL'])
  })

  it('does not miss a placeholder with a default, and fills it from the pool when set', () => {
    const entry = { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN:-}' } }
    expect(keysOf('x', entry, { aliases: {}, trackers: [] }, {})).toEqual({ values: {}, env: {}, missing: [], names: ['TOKEN'] })
    expect(keysOf('x', entry, { aliases: {}, trackers: [] }, { TOKEN: 'secret' }).values).toEqual({ TOKEN: 'secret' })
  })

  it('leaves an HTTP server named as a tracker to its placeholders', () => {
    const tracker = { server: 'github', variables: ['GITHUB_TOKEN'], ready: () => false }
    expect(keysOf('github', github, { aliases: { GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_TOKEN' }, trackers: [tracker] }, { GITHUB_TOKEN: 'x' }).missing).toEqual([])
  })
})

describe('substitute', () => {
  it('fills the placeholders it has values for', () => {
    expect(substitute(github, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' }).headers).toEqual({ Authorization: 'Bearer ghp_example', 'X-MCP-Toolsets': 'issues,labels' })
  })

  it('puts the default of a placeholder without a value', () => {
    const entry = { headers: { A: 'Bearer ${TOKEN:-}', B: '${MODE:-fast}', C: '${MODE:-fast}' } }
    expect(substitute(entry, { MODE: 'slow' }).headers).toEqual({ A: 'Bearer ', B: 'slow', C: 'slow' })
  })
})

describe('settings with a defaulted key', () => {
  it('are not settings', () => {
    expect(defaultSettings({ strata: { type: 'http', url: 'https://example.com', headers: { Authorization: 'Bearer ${TOKEN:-}' } } })).toEqual({})
  })
})

describe('settings', () => {
  it('are the env of a stdio server and the plain headers of an HTTP one', () => {
    expect(defaultSettings({ huly, github })).toEqual({ TOOLSETS: 'issues,projects', 'X-MCP-Toolsets': 'issues,labels' })
  })

  it('apply where the entry has the key', () => {
    expect(applySettings(huly, { TOOLSETS: 'issues', 'X-MCP-Toolsets': 'labels' })).toEqual({ ...huly, env: { TOOLSETS: 'issues' } })
    expect(applySettings(github, { 'X-MCP-Toolsets': 'labels' }).headers).toEqual({ Authorization: github.headers.Authorization, 'X-MCP-Toolsets': 'labels' })
  })
})

describe('upsertEnv', () => {
  it('replaces the line of the variable and keeps the rest', () => {
    expect(upsertEnv('# comment\nHULY_URL=old\nOTHER=1\n', 'HULY_URL', 'https://huly.example.com')).toBe('# comment\nHULY_URL=https://huly.example.com\nOTHER=1\n')
  })

  it('appends a new variable, also after a commented-out example of it', () => {
    expect(upsertEnv('# GITHUB_TOKEN=change-me\n', 'GITHUB_TOKEN', 'ghp_x')).toBe('# GITHUB_TOKEN=change-me\nGITHUB_TOKEN=ghp_x\n')
    expect(upsertEnv('A=1', 'B', '2')).toBe('A=1\nB=2\n')
    expect(upsertEnv('', 'B', '2')).toBe('B=2\n')
  })

  it('quotes a value the parser would cut, and refuses one it cannot hold', () => {
    expect(envLine('K', 'a b#c')).toBe("K='a b#c'")
    expect(() => envLine('K', "it's\n")).toThrow()
    expect(() => envLine('bad name', 'x')).toThrow()
  })
})
