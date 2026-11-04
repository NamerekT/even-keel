import { afterEach, describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { fakeCliCommand, finishFakeCli, withCliCopies } from './fakeCliCopies.js'

const inherited = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']
const targets = [Object.prototype, Object, Object.prototype.toString, Object.prototype.valueOf, Object.prototype.hasOwnProperty]
const descriptors = targets.map((target) => Object.getOwnPropertyDescriptors(target))

afterEach(() => {
  targets.forEach((target, index) => {
    const original = descriptors[index]!
    for (const key of Reflect.ownKeys(target)) {
      if (!Object.hasOwn(original, key)) Reflect.deleteProperty(target, key)
    }
    Object.defineProperties(target, original)
  })
})

function state(): EvenKeelState {
  return {
    config: { shared: { cli: {} } },
    account: { missing: ['codex'] },
    chain: { active: [] },
  } as unknown as EvenKeelState
}

describe('fake CLI provider selection', () => {
  it.each(['', 'unknown', ...inherited])('ignores an unknown copyAgent %j without touching prototypes', (agent) => {
    const initial = state()
    expect(withCliCopies(initial, new URLSearchParams({ copies: 'downloading', copyAgent: agent }))).toBe(initial)
    targets.forEach((target, index) => expect(Object.getOwnPropertyDescriptors(target)).toEqual(descriptors[index]))
  })

  it.each(['', 'unknown', ...inherited])('ignores an unknown copyFailed %j without touching prototypes', (agent) => {
    const result = withCliCopies(state(), new URLSearchParams({ copies: 'downloading', copyFailed: agent }))
    expect(result.cliCopies?.claude?.status).toBe('downloading')
    expect(result.cliCopies?.codex?.status).toBe('ready')
    targets.forEach((target, index) => expect(Object.getOwnPropertyDescriptors(target)).toEqual(descriptors[index]))
  })

  it('keeps defaults, simultaneous failures and repeated calls independent', () => {
    const initial = state()
    const params = new URLSearchParams({ copies: 'downloading', copyFailed: 'codex' })
    const first = withCliCopies(initial, params)
    expect(first.cliCopies?.claude?.status).toBe('downloading')
    expect(first.cliCopies?.codex).toMatchObject({ status: 'failed', source: 'system' })
    expect(withCliCopies(initial, params)).toEqual(first)
    expect(initial).toEqual(state())
    expect(withCliCopies(initial, new URLSearchParams({ copies: 'downloading', copyFailed: 'claude' })).cliCopies?.claude?.status).toBe('downloading')
    expect(withCliCopies(initial, new URLSearchParams())).toBe(initial)
  })

  it.each(['unknown', ...inherited])('refuses an unknown command agent %j and leaves completion alone', (agent) => {
    const initial = withCliCopies(state(), new URLSearchParams({ copies: 'ready' }))
    expect(() => fakeCliCommand(initial, 'cli/download', { agent })).toThrow('Unknown agent')
    expect(finishFakeCli(initial, agent)).toBe(initial)
  })

  it('downloads and completes a known CLI', () => {
    const initial = withCliCopies(state(), new URLSearchParams({ copies: 'ready', copyAgent: 'codex' }))
    const downloading = fakeCliCommand(initial, 'cli/download', { agent: 'codex' })!
    expect(downloading.cliCopies?.codex?.status).toBe('downloading')
    const ready = finishFakeCli(downloading, 'codex')
    expect(ready.cliCopies?.codex).toMatchObject({ status: 'ready', received: ready.cliCopies?.codex?.total })
    expect(ready.account.missing).not.toContain('codex')
    expect(finishFakeCli(ready, 'codex')).toBe(ready)
  })
})
