import { describe, expect, it } from 'vitest'
import type { BadgeState } from './model.js'
import { bannedOf, looksPrivate, privateLayer, withoutPrivate, type PrivacyField, type PrivacyLayer } from './privacy.js'

describe('looksPrivate', () => {
  it.each([
    ['an OpenAI-style key', 'Call the API with sk-abc123def456'],
    ['an Anthropic key', 'Use sk-ant-api03-abcdef'],
    ['a GitHub token', 'Push with ghp_abcdefghijklmnop'],
    ['a GitHub fine-grained token', 'Set github_pat_11ABCDEFG0abcdef'],
    ['a GitLab token', 'Use glpat-abcdefghij'],
    ['a Slack token', 'Post with xoxb-1234-abcdef'],
    ['an AWS key id', 'Key AKIAIOSFODNN7EXAMPLE'],
    ['a JWT', 'Send eyJhbGciOiJIUzI1NiJ9.payload'],
    ['an assignment', 'Run with TOKEN=abc'],
    ['a flag with a value', 'Start with --password=hunter2'],
    ['a named secret', 'password: hunter2'],
    ['a bearer token', 'Authorization: Bearer abcdefgh12345678'],
    ['a URL', 'Open https://tracker.example.com/issue/1'],
    ['a URL with credentials', 'Clone ssh://john:pass@forge.example.com/repo'],
    ['an e-mail', 'Write to john.doe@example.com'],
    ['a phone with a plus', 'Call +49 151 2345678'],
    ['a phone without a plus', 'Call (555) 123-45-67 890'],
    ['an IPv4 address', 'Ping 192.168.1.10'],
    ['an IPv6 address', 'Ping fe80::1ff:fe23:4567:890a'],
    ['the IPv6 loopback', 'Listen on ::1'],
    ['a MAC address', 'Wake aa:bb:cc:dd:ee:ff'],
    ['a host', 'Deploy to forge.example.com'],
    ['a tailnet host', 'Open even-keel.tail-fake.ts.net'],
    ['a host with a repository path', 'Fetch github.com/example/repo'],
    ['localhost', 'Query localhost:4747'],
    ['a Windows path', 'Read C:\\Users\\john\\notes'],
    ['a Windows path with slashes', 'Read d:/Projects/example'],
    ['a UNC path', 'Copy \\\\nas\\share'],
    ['a Linux home path', 'List /home/john/projects'],
    ['a macOS home path', 'List /Users/john'.concat('/Desktop')],
    ['a home shortcut', 'Read ~/.claude/settings'],
  ])('catches %s', (_name, text) => {
    expect(looksPrivate(text)).toBe(true)
  })

  it.each([
    ['a plain description', 'Run the badge tests'],
    ['a path inside the repository', 'Edit src/badge/push.ts'],
    ['a file at the root', 'Read package.json'],
    ['a file with two dots', 'Edit src/badge/push.test.ts'],
    ['a dot file', 'Edit .env.example'],
    ['a three-part version', 'Bump to 1.2.3'],
    ['a milestone', 'Finish v0.3 tasks'],
    ['a date and a time', 'Release notes of 2026-11-10 12:30:45'],
    ['a page route', 'Fix the /stats page'],
    ['a package with a version', 'Install vitest@3.2.1'],
    ['a plugin of a marketplace', 'Enable tasks@even-keel'],
    ['a comparison', 'Check that a >= b and c == d'],
    ['an arrow', 'Map x=>y'],
    ['a slash between words', 'Read and/or write'],
    ['a scope', 'Rename BadgeState::active'],
    ['a count', 'Hold the file to 13000 bytes'],
    ['an abbreviation', 'Tidy up, e.g. the tests'],
  ])('lets %s through', (_name, text) => {
    expect(looksPrivate(text)).toBe(false)
  })

  it('takes a four-part version for an IP address: it cannot tell them apart', () => {
    expect(looksPrivate('Bump to 1.2.3.4')).toBe(true)
  })

  it('takes a dotted name for a host unless it ends like a file', () => {
    expect(looksPrivate('Read src/x.ts')).toBe(false)
    expect(looksPrivate('Read x.ts')).toBe(false)
    expect(looksPrivate('Check state.tasks')).toBe(true)
    expect(looksPrivate('Open example.io')).toBe(true)
  })

  it('takes a dotted name ending in a camel-case word for a setting, not a host', () => {
    expect(looksPrivate('Remove the label: empty chain.excludedLabels by default')).toBe(false)
    expect(looksPrivate('Read config.trackerProjects')).toBe(false)
    expect(looksPrivate('Open Example.Com')).toBe(true)
    expect(looksPrivate('Open myBox.example.io')).toBe(true)
  })
})

describe('bannedOf', () => {
  it('lowers the case, drops duplicates, short strings, common words and the allowed ones', () => {
    expect(bannedOf(['John', 'john', 'ab', '  ', null, undefined, 'work', 'Global', 'ABC', 'XYZ'], ['abc'])).toEqual(['john', 'xyz'])
  })

  it('leaves out the words an account or a profile is labelled with and the names of products', () => {
    const labels = ['OpenRouter', 'Key', 'Free', 'Balance', 'Organization', 'Anthropic', 'OpenAI', 'GitHub', 'Linear', 'Huly', 'Tally', 'Codex', 'GUID']
    expect(bannedOf([...labels, 'Roe'])).toEqual(['roe'])
  })

  it('adds the name of an e-mail, the host of an address and the tailnet of a ts.net host', () => {
    expect(bannedOf(['john.doe@example.com'])).toEqual(['john.doe@example.com', 'john.doe'])
    expect(bannedOf(['https://huly.example.com/workbench'])).toEqual(['https://huly.example.com/workbench', 'huly.example.com'])
    expect(bannedOf(['https://box.tail-fake.ts.net:8443'])).toEqual(['https://box.tail-fake.ts.net:8443', 'box.tail-fake.ts.net', 'tail-fake'])
    expect(bannedOf(['box.tail-fake.ts.net'])).toEqual(['box.tail-fake.ts.net', 'tail-fake'])
  })
})

describe('privateLayer', () => {
  const banned = bannedOf(['JohnDoe', 'XYZ', 'Acme Rockets'])

  it('finds a forbidden string in any case, only where it stands as a word', () => {
    expect(privateLayer('Fix the build for johndoe', banned)).toBe('identifier')
    expect(privateLayer('Sync with XYZ-12', banned)).toBe('identifier')
    expect(privateLayer('Ship ACME ROCKETS site', banned)).toBe('identifier')
    expect(privateLayer('Rename xyzzy', banned)).toBeNull()
    expect(privateLayer('Run the tests', banned)).toBeNull()
  })

  it('lets a title through that shares only label words with an account, and still catches the owner', () => {
    const banned = bannedOf(['OpenRouter Key', 'OpenRouter', 'Key', "john.doe@example.com's Organization", "john.doe@example.com's", 'Organization', 'Claude John free', 'Claude', 'John', 'free', 'FAKE-PC'])
    expect(privateLayer('Badge: statistics always show 0 sessions; project GUID sent to Tally instead of key', banned)).toBeNull()
    expect(privateLayer('Free the slot of an organization', banned)).toBeNull()
    expect(privateLayer('Fix the limits of John', banned)).toBe('identifier')
    expect(privateLayer('Restart fake-pc', banned)).toBe('identifier')
    expect(privateLayer('Mail john.doe@example.com', banned)).toBe('identifier')
  })

  it('names the pattern layer when no string of the service matched', () => {
    expect(privateLayer('Ping 192.168.1.10', banned)).toBe('pattern')
    expect(privateLayer('Run the tests', [])).toBeNull()
  })

  it('answers with an error instead of letting the text through when the filter fails', () => {
    expect(privateLayer(undefined as unknown as string, [])).toBe('error')
  })
})

describe('withoutPrivate', () => {
  const state = (active: BadgeState['active']): BadgeState => ({ v: 1, at: '2026-11-10T12:00:00.000Z', project: { key: 'ABC', name: 'Example' }, active, chain: { state: 'running', next: null } })
  const run = (active: BadgeState['active'], banned: string[] = []) => {
    const reports: [PrivacyField, PrivacyLayer][] = []
    return { result: withoutPrivate(state(active), banned, (field, layer) => reports.push([field, layer])), reports }
  }

  it('leaves a clean state as it is', () => {
    const active: BadgeState['active'] = [{ key: 'ABC-1', state: 'working', titleEn: 'Fix the badge', action: { tool: 'Bash', text: 'Bash Run the tests' } }]
    const { result, reports } = run(active)
    expect(result.active).toEqual(active)
    expect(reports).toEqual([])
  })

  it('drops a caught title whole: the push has no key, the task keeps its key and state', () => {
    const { result, reports } = run([{ key: 'ABC-1', state: 'working', titleEn: 'Move the site of Acme Rockets' }], ['acme rockets'])
    expect(result.active).toEqual([{ key: 'ABC-1', state: 'working' }])
    expect('titleEn' in result.active[0]!).toBe(false)
    expect(JSON.stringify(result)).not.toContain('redacted')
    expect(reports).toEqual([['titleEn', 'identifier']])
  })

  it('leaves a caught action only its tool, and no action when the tool itself is caught', () => {
    const { result, reports } = run([
      { key: 'ABC-1', state: 'working', action: { tool: 'Bash', text: 'Bash Deploy to forge.example.com' } },
      { key: 'ABC-2', state: 'waiting', action: { tool: 'johndoe', text: 'johndoe' } },
      { key: 'ABC-3', state: 'working', action: null },
    ], ['johndoe'])
    expect(result.active.map((task) => task.action)).toEqual([{ tool: 'Bash', text: 'Bash' }, null, null])
    expect(reports).toEqual([['action.text', 'pattern'], ['action.tool', 'identifier']])
  })

  it('drops every free text without a report\'s layer of its own while the list is not read', () => {
    const reports: [PrivacyField, PrivacyLayer][] = []
    const result = withoutPrivate(state([{ key: 'ABC-1', state: 'working', titleEn: 'Fix the badge', action: { tool: 'Bash', text: 'Bash Run the tests' } }]), null, (field, layer) => reports.push([field, layer]))
    expect(result.active).toEqual([{ key: 'ABC-1', state: 'working', action: null }])
    expect(reports).toEqual([['titleEn', 'unready'], ['action.tool', 'unready']])
  })

  it('does not change the state it was given', () => {
    const active: BadgeState['active'] = [{ key: 'ABC-1', state: 'working', titleEn: 'Ping 192.168.1.10' }]
    run(active)
    expect(active[0]!.titleEn).toBe('Ping 192.168.1.10')
  })
})
