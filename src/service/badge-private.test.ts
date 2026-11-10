import { describe, expect, it } from 'vitest'
import type { EvenKeelConfig } from '../config.js'
import type { EvenKeelState } from '../state.js'
import { bannedFor, type MachineFacts } from './badge-private.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const machine: MachineFacts = { user: 'SYSTEM', host: 'FAKE-PC', home: 'C:\\Users\\jdoe', env: { CLAUDE_CONFIG_DIR: 'C:\\Users\\jdoe\\.claude-second', EVEN_KEEL_HOST: 'box.tail-fake.ts.net' } }
const config = {
  projects: { [ABC]: 'D:/repos/example', [XYZ]: '/home/builder/other' },
  keys: { [ABC]: 'ABC', [XYZ]: 'XYZ' },
  names: { [ABC]: 'Example', [XYZ]: 'Acme Rockets' },
  trackerProjects: { [XYZ]: 'acme/rockets' },
  accounts: { claude: 'claude-main' },
  allowedHosts: ['panel.example.org'],
} as unknown as EvenKeelConfig
const state = {
  projectKeys: { [ABC]: 'ABC', [XYZ]: 'XYZ' },
  taskPrefixes: { [ABC]: 'ABC', [XYZ]: 'ROCK' },
  account: {
    accounts: [{ key: 'claude-second', name: 'Jane Roe', lastEmail: 'old@example.com', formerEmail: null, status: { email: 'jane.roe@example.com', orgName: 'Roe Labs' } }],
    apps: [{ account: 'app@example.com', dir: 'C:\\Users\\jdoe\\.claude-app' }],
    pool: [{ account: 'claude-pool' }],
  },
  profiles: { profiles: [{ name: 'Team tracker', login: 'jroe', fields: [{ secret: false, value: 'https://huly.example.net/workbench' }, { secret: true, value: null }, { secret: false, value: 'roe-space' }] }] },
  trackerUrls: { default: 'https://issues.example.net/{id}', projects: {}, pages: { [ABC]: null } },
  git: { name: 'John Doe', email: 'john@example.com' },
} as unknown as EvenKeelState

describe('bannedFor', () => {
  const banned = bannedFor(state, config, ABC, machine, { name: 'Repo Committer', email: 'committer@example.com' })

  it('takes the accounts, their folders and their owners', () => {
    expect(banned).toEqual(expect.arrayContaining(['claude-second', 'jane roe', 'jane', 'old@example.com', 'jane.roe@example.com', 'jane.roe', 'roe labs', 'labs', 'app@example.com', '.claude-app', 'claude-pool', 'claude-main']))
  })

  it('takes the machine: its user, its name and the user of the home folder when the service runs as another one', () => {
    expect(banned).toEqual(expect.arrayContaining(['fake-pc', 'jdoe', '.claude-second']))
    expect(banned).not.toContain('system')
  })

  it('takes the profiles with their hosts and logins, the tracker links and the addresses of the page with the tailnet', () => {
    expect(banned).toEqual(expect.arrayContaining(['team tracker', 'jroe', 'huly.example.net', 'roe-space', 'issues.example.net', 'box.tail-fake.ts.net', 'tail-fake', 'panel.example.org']))
  })

  it('takes the git identity of the machine and of the repository', () => {
    expect(banned).toEqual(expect.arrayContaining(['john doe', 'john', 'john@example.com', 'repo committer', 'committer', 'committer@example.com']))
  })

  it('takes every other project and leaves the badge\'s own', () => {
    expect(banned).toEqual(expect.arrayContaining(['xyz', 'acme rockets', 'rock', 'acme/rockets', 'builder']))
    expect(banned).not.toContain('abc')
    expect(banned).not.toContain('example')
    expect(bannedFor(state, config, XYZ, machine, null)).toEqual(expect.arrayContaining(['abc', 'example']))
  })

  it('reads a state without accounts, profiles or links', () => {
    expect(bannedFor({} as EvenKeelState, { projects: {} } as unknown as EvenKeelConfig, ABC, { user: null, host: null, home: null, env: {} }, null)).toEqual([])
  })
})
