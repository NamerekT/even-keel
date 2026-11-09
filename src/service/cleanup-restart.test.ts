import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitResult } from '../git/types.js'
import { leftBehind } from '../git/worktree.js'
import { Lingering, type LeftFolder } from '../sessions/lingering.js'
import { deferLeftFolder, STOP_RETRY_MS, stopLingering, stopTaskSessions } from './chain.js'

let repo: string
let place: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'btn-925-'))
  place = join(repo, '.claude', 'worktrees', 'abc-1')
  mkdirSync(place, { recursive: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-09T03:26:06Z'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(repo, { recursive: true, force: true })
})

/** The state database's rows, as the service writes them behind. */
function savedRows() {
  const rows = new Map<string, LeftFolder>()
  return { rows, store: { save: (folder: LeftFolder) => rows.set(folder.path, folder), drop: (path: string) => rows.delete(path) } }
}

function service(stored: LeftFolder[], store: ReturnType<typeof savedRows>['store']) {
  const lingering = new Lingering()
  lingering.restore(stored, store)
  const leftover = vi.fn()
  const ctx = { launches: [], agents: [], agentsRead: false, lingering, dispatcher: { leftover } } as unknown as Parameters<typeof stopTaskSessions>[0] & {
    agentsRead: boolean
  }
  return { ctx, leftover }
}

const free = async (): Promise<GitResult> => ({ code: 0, out: '' })
const held = async (): Promise<GitResult> => {
  throw new Error('EBUSY: resource busy or locked')
}

describe('a folder left after Done survives a restart (BTN-925)', () => {
  it('is removed after the restart once the monitor has read the sessions, and its row goes', async () => {
    const { rows, store } = savedRows()
    const before = service([], store)
    deferLeftFolder(before.ctx, 'project-1', repo, 'ABC-1', [leftBehind(place, 'error: Permission denied')])
    expect([...rows.values()]).toEqual([{ project: 'project-1', task: 'ABC-1', repo, path: place, until: Date.now() + STOP_RETRY_MS }])

    vi.setSystemTime(Date.now() + 60_000)
    const after = service([...rows.values()], store)
    await stopLingering(after.ctx, free)
    expect(existsSync(place)).toBe(true)

    after.ctx.agentsRead = true
    await stopLingering(after.ctx, free)
    expect(existsSync(place)).toBe(false)
    expect(rows.size).toBe(0)
    expect(after.leftover).not.toHaveBeenCalled()
  })

  it('keeps its row while still held within the wait counted from the Done', async () => {
    const { rows, store } = savedRows()
    const until = Date.now() + STOP_RETRY_MS
    const after = service([{ project: 'project-1', task: 'ABC-1', repo, path: place, until }], store)
    after.ctx.agentsRead = true
    await stopLingering(after.ctx, held)
    await stopLingering(after.ctx, held)
    expect(after.leftover).not.toHaveBeenCalled()

    vi.setSystemTime(until)
    await stopLingering(after.ctx, held)
    expect(after.leftover).toHaveBeenCalledTimes(1)
    expect(rows.size).toBe(0)
  })

  it('is tried once at once when its wait ran out while the service was down, and warned about if still held', async () => {
    const { rows, store } = savedRows()
    rows.set(place, { project: 'project-1', task: 'ABC-1', repo, path: place, until: Date.now() - 1 })
    const after = service([...rows.values()], store)
    after.ctx.agentsRead = true

    await stopLingering(after.ctx, held)
    expect(after.leftover).toHaveBeenCalledTimes(1)
    expect(after.leftover.mock.calls[0]!.slice(0, 2)).toEqual(['project-1', 'ABC-1'])
    expect((after.leftover.mock.calls[0] as unknown[])[2]).toMatchObject({ code: 'cleanup.folderLeft' })
    expect(rows.size).toBe(0)
    await stopLingering(after.ctx, held)
    expect(after.leftover).toHaveBeenCalledTimes(1)
  })
})
