import { describe, expect, it } from 'vitest'
import type { AccountEntry } from '../../src/account/model.js'
import type { MachineSignIn } from '../../src/state.js'
import { machineGaps, machineLogin, machineSend, machineTokens } from './machineSignIn.js'

const hub = (patch: Partial<AccountEntry> = {}): AccountEntry => ({
  key: 'john.doe@example.com', name: null, global: false, agent: 'claude',
  status: { loggedIn: true, authMethod: 'claude.ai', email: 'John.Doe@example.com', orgName: null, subscriptionType: 'max' },
  error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false, configPending: false, apiKey: false,
  limits: null, usage: { state: 'ok', reason: null, since: null },
  ...patch,
} as AccountEntry)

const machine = (patch: Partial<MachineSignIn> = {}): MachineSignIn => ({
  machine: 'machine-1', name: 'Example laptop', online: true, accounts: [], login: null, missing: [], ...patch,
})

describe('a hub account on the machines elsewhere', () => {
  it('names each machine where the account is not signed in, its own signed-out folder if it has one', () => {
    const machines = [
      machine(),
      machine({ machine: 'machine-2', name: 'Example desktop', online: false, accounts: [{ key: 'work', agent: 'claude', email: 'john.doe@example.com', signedIn: false }] }),
      machine({ machine: 'machine-3', accounts: [{ key: 'other', agent: 'claude', email: 'john.doe@example.com', signedIn: true }] }),
      machine({ machine: 'machine-4', accounts: [{ key: 'john.doe@example.com', agent: 'claude', email: null, signedIn: false }], missing: ['claude'] }),
      machine({ machine: 'machine-5', accounts: [{ key: 'codex', agent: 'codex', email: 'john.doe@example.com', signedIn: true }] }),
    ]
    expect(machineGaps(hub(), machines)).toEqual([
      { machine: 'machine-1', name: 'Example laptop', online: true, noCli: false },
      { machine: 'machine-2', name: 'Example desktop', online: false, account: 'work', noCli: false },
      { machine: 'machine-4', name: 'Example laptop', online: true, account: 'john.doe@example.com', noCli: true },
      { machine: 'machine-5', name: 'Example laptop', online: true, noCli: false },
    ])
  })

  it('offers nothing for an account signed out on the hub, a key, a cloud, a long token, or with no machines', () => {
    const machines = [machine()]
    expect(machineGaps(hub({ status: { loggedIn: false, authMethod: null, email: 'john.doe@example.com', orgName: null, subscriptionType: null } }), machines)).toEqual([])
    expect(machineGaps(hub({ apiKey: true }), machines)).toEqual([])
    expect(machineGaps(hub({ cloud: { cloud: 'bedrock' } as unknown as AccountEntry['cloud'] }), machines)).toEqual([])
    expect(machineGaps(hub({ longToken: { until: null } }), machines)).toEqual([])
    expect(machineGaps(hub(), undefined)).toEqual([])
  })

  it('names the machines that run the account on a long token, and none where a full sign-in is there too (BTN-1002)', () => {
    const onToken = { key: 'token', agent: 'claude', email: 'john.doe@example.com', signedIn: true, longToken: true as const }
    const full = { key: 'full', agent: 'claude', email: 'john.doe@example.com', signedIn: true }
    const machines = [
      machine({ accounts: [onToken] }),
      machine({ machine: 'machine-2', accounts: [onToken, full] }),
      machine({ machine: 'machine-3', accounts: [{ ...onToken, email: 'jane.roe@example.com' }] }),
      machine({ machine: 'machine-4', accounts: [{ ...onToken, signedIn: false }] }),
    ]
    expect(machineTokens(hub(), machines)).toEqual([{ machine: 'machine-1', name: 'Example laptop' }])
    expect(machineGaps(hub(), machines).map((gap) => gap.machine)).toEqual(['machine-3', 'machine-4'])
  })

  it("finds the machine's sign-in under way and sends its steps to that machine", async () => {
    const login = { agent: 'claude', target: null, startedAt: '2026-11-17T10:00:00.000Z', urls: [], deviceCode: null, output: '', error: null, codeSent: false }
    expect(machineLogin([machine(), machine({ machine: 'machine-2', login })])?.machine).toBe('machine-2')
    expect(machineLogin([machine()])).toBeUndefined()

    const sent: [string, Record<string, unknown> | undefined][] = []
    const send = machineSend('machine-2', async (name, body) => {
      sent.push([name, body])
      return true
    })
    await send('account/code', { code: 'one-time-code' })
    await send('account/cancel')
    await send('account/renew', { account: 'work' })
    await send('account/add', { agent: 'codex', method: 'device' })
    expect(sent).toEqual([
      ['machines/code', { machine: 'machine-2', code: 'one-time-code' }],
      ['machines/cancel', { machine: 'machine-2' }],
      ['machines/login', { machine: 'machine-2', account: 'work' }],
      ['machines/login', { machine: 'machine-2', agent: 'codex', method: 'device' }],
    ])
  })
})
