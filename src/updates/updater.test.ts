import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActiveChain } from '../chain/model.js'
import { windowsControl } from './control.js'
import type { Checkout, UpdateRecord } from './model.js'
import type { UpdatePlan } from './runner.js'
import { stateUrlOf, Updater, type UpdaterOptions } from './updater.js'

const STORAGE = { schema: 9, database: 11, tally: 5 }
const ON_TAG: Checkout = { commit: 'a1b2c3d', branch: 'main', tags: ['v0.1.0'], dirty: false }
const RELEASE = { version: '0.2.0', tag: 'v0.2.0', url: 'https://example.com/v0.2.0' }

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'updater-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function updater(extra: Partial<UpdaterOptions> & { chains?: ActiveChain[][] } = {}) {
  const plans: UpdatePlan[] = []
  const rounds = extra.chains ?? [[]]
  let round = 0
  const options: UpdaterOptions = {
    root,
    current: '0.1.0',
    storage: STORAGE,
    startedAt: '2026-10-22T09:00:00.000Z',
    active: () => rounds[Math.min(round, rounds.length - 1)]!,
    stateUrl: () => 'http://127.0.0.1:4747/api/state',
    onChange: () => {},
    log: () => {},
    control: async () => windowsControl('EvenKeel'),
    checkout: async () => ON_TAG,
    launch: (plan) => plans.push(plan),
    sleep: () =>
      new Promise((resolve) =>
        setTimeout(() => {
          round++
          resolve()
        }, 1),
      ),
    ...extra,
  }
  return { updater: new Updater(options), plans }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('stateUrlOf', () => {
  it('reaches a wildcard address on loopback and brackets IPv6', () => {
    expect(stateUrlOf('0.0.0.0', 4747)).toBe('http://127.0.0.1:4747/api/state')
    expect(stateUrlOf('::', 4747)).toBe('http://127.0.0.1:4747/api/state')
    expect(stateUrlOf('100.64.0.7', 5000)).toBe('http://100.64.0.7:5000/api/state')
    expect(stateUrlOf('::1', 4747)).toBe('http://[::1]:4747/api/state')
  })
})

describe('Updater', () => {
  it('offers the update on a clean checkout on its release tag', async () => {
    const { updater: subject } = updater()
    expect(subject.view().blocked).toBe('checking')
    await subject.start()
    expect(subject.view()).toEqual({ blocked: null, previous: null, progress: null, result: null })
  })

  it('names why it offers none', async () => {
    const { updater: subject } = updater({ control: async () => null })
    await subject.start()
    expect(subject.view().blocked).toBe('service')
    await expect(subject.update(RELEASE)).rejects.toMatchObject({ notice: { code: 'updates.blocked', params: { reason: 'service' } } })
  })

  it('launches the update process with what it needs to come back', async () => {
    const { updater: subject, plans } = updater()
    await subject.start()
    await subject.update(RELEASE)
    await settled()
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      mode: 'update',
      install: 'ci',
      root,
      target: { version: '0.2.0', tag: 'v0.2.0' },
      from: { version: '0.1.0', commit: 'a1b2c3d', branch: 'main', tag: 'v0.1.0', storage: STORAGE },
      service: { stop: windowsControl('EvenKeel').stop },
      state: 'http://127.0.0.1:4747/api/state',
      startedAt: '2026-10-22T09:00:00.000Z',
      settleMs: 0,
    })
    expect(subject.view().progress).toEqual({ mode: 'update', target: '0.2.0', phase: 'running', waiting: [] })
    await expect(subject.update(RELEASE)).rejects.toMatchObject({ notice: { code: 'updates.running' } })
  })

  it('waits for a chain in a launch before it launches', async () => {
    const launching = { project: 'ABC', current: { task: 'ABC-1', sessionId: null }, paused: false, error: null } as unknown as ActiveChain
    const { updater: subject, plans } = updater({ chains: [[launching], [launching], []] })
    await subject.start()
    await subject.update(RELEASE)
    expect(subject.view().progress).toMatchObject({ phase: 'settling', waiting: ['ABC'] })
    await settled()
    expect(plans).toHaveLength(1)
  })

  it('shows a launch that failed as the result', async () => {
    const { updater: subject } = updater({
      launch: () => {
        throw new Error('dist/updates/run.js is missing')
      },
    })
    await subject.start()
    await subject.update(RELEASE)
    await settled()
    expect(subject.view()).toMatchObject({ progress: null, result: { mode: 'update', step: 'launch', output: 'dist/updates/run.js is missing', rollback: 'none' } })
  })

  it('reverts to the tag the last update came from, and the result closes for good', async () => {
    const record: UpdateRecord = {
      mode: 'update',
      from: { version: '0.0.9', commit: 'f00ba47', branch: 'main', tag: 'v0.0.9', storage: STORAGE },
      to: { version: '0.1.0', tag: 'v0.1.0' },
      startedAt: '2026-10-22T08:00:00.000Z',
      finishedAt: '2026-10-22T08:03:00.000Z',
      failed: null,
      rollback: null,
      seen: false,
    }
    mkdirSync(join(root, 'logs'))
    writeFileSync(join(root, 'logs', 'update.json'), JSON.stringify(record))
    const { updater: subject, plans } = updater()
    await subject.start()
    expect(subject.view()).toMatchObject({ previous: { version: '0.0.9', blocked: null }, result: { from: '0.0.9', to: '0.1.0', step: null } })
    subject.seen()
    expect(subject.view().result).toBeNull()
    expect(JSON.parse(readFileSync(join(root, 'logs', 'update.json'), 'utf8')).seen).toBe(true)
    await subject.revert()
    await settled()
    expect(plans[0]).toMatchObject({ mode: 'revert', target: { version: '0.0.9', tag: 'v0.0.9' }, from: { version: '0.1.0', tag: 'v0.1.0' } })
  })

  it('refuses a revert across a storage change', async () => {
    const record = {
      mode: 'update',
      from: { version: '0.0.9', commit: 'f00ba47', branch: 'main', tag: 'v0.0.9', storage: { ...STORAGE, schema: 8 } },
      to: { version: '0.1.0', tag: 'v0.1.0' },
      failed: null,
      rollback: null,
    }
    mkdirSync(join(root, 'logs'))
    writeFileSync(join(root, 'logs', 'update.json'), JSON.stringify(record))
    const { updater: subject } = updater()
    await subject.start()
    expect(subject.view().previous).toEqual({ version: '0.0.9', blocked: 'storage' })
    await expect(subject.revert()).rejects.toMatchObject({ notice: { code: 'updates.blocked', params: { reason: 'storage' } } })
  })
})
