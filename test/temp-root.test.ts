import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunRoot, isStale, removeRunRoot, RUN_FILE, RUNS_FOLDER, STALE_MS, sweepRuns } from './temp-root.js'
import setup from './temp-setup.js'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const HOUR = 60 * 60 * 1000
const roots: string[] = []

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function base(): string {
  const root = mkdtempSync(join(tmpdir(), 'runs-'))
  roots.push(root)
  return root
}

function run(parent: string, name: string, mark: object | null, modifiedMs = NOW): string {
  const folder = join(parent, name)
  mkdirSync(folder)
  if (mark !== null) writeFileSync(join(folder, RUN_FILE), JSON.stringify(mark))
  utimesSync(folder, new Date(modifiedMs), new Date(modifiedMs))
  return folder
}

describe('the run root of a vitest run', () => {
  it('is the temp folder of the worker and of its child processes', () => {
    const root = tmpdir()
    expect(basename(dirname(root))).toBe(RUNS_FOLDER)
    expect(existsSync(join(root, RUN_FILE))).toBe(true)
    expect(execFileSync(process.execPath, ['-e', "console.log(require('os').tmpdir())"], { encoding: 'utf8' }).trim()).toBe(root)
  })

  it('is named by the pid and six characters and carries the pid and start time', () => {
    const root = createRunRoot(join(base(), RUNS_FOLDER), 4321, NOW)
    expect(basename(root)).toMatch(/^4321-.{6}$/)
    expect(JSON.parse(readFileSync(join(root, RUN_FILE), 'utf8'))).toEqual({ pid: 4321, started: NOW })
  })
})

describe('which folder of another run the sweep removes', () => {
  const alive = (pid: number) => pid === 1

  it('removes a run whose process is gone', () => {
    expect(isStale({ mark: { pid: 2, started: NOW - HOUR }, modifiedMs: NOW }, NOW, alive)).toBe(true)
  })

  it('keeps a run whose process lives and is younger than a day', () => {
    expect(isStale({ mark: { pid: 1, started: NOW - HOUR }, modifiedMs: NOW - 2 * STALE_MS }, NOW, alive)).toBe(false)
  })

  it('removes a run older than a day whatever its pid', () => {
    expect(isStale({ mark: { pid: 1, started: NOW - STALE_MS - 1 }, modifiedMs: NOW }, NOW, alive)).toBe(true)
  })

  it('judges a folder without a mark only by its age', () => {
    const never = vi.fn(() => false)
    expect(isStale({ mark: null, modifiedMs: NOW - HOUR }, NOW, never)).toBe(false)
    expect(isStale({ mark: null, modifiedMs: NOW - STALE_MS - 1 }, NOW, never)).toBe(true)
    expect(never).not.toHaveBeenCalled()
  })
})

describe('sweepRuns', () => {
  it('removes the stale folders and keeps the live ones', () => {
    const parent = base()
    const dead = run(parent, 'dead', { pid: 2, started: NOW - HOUR })
    const live = run(parent, 'live', { pid: 1, started: NOW - HOUR })
    const old = run(parent, 'old', { pid: 1, started: NOW - 2 * STALE_MS })
    const fresh = run(parent, 'fresh', null, NOW - HOUR)
    const abandoned = run(parent, 'abandoned', null, NOW - 2 * STALE_MS)
    const broken = run(parent, 'broken', { pid: 'x' }, NOW - 2 * STALE_MS)
    writeFileSync(join(live, 'kept.txt'), '')
    expect(sweepRuns(parent, NOW, (pid) => pid === 1).sort()).toEqual(['abandoned', 'broken', 'dead', 'old'])
    expect([dead, live, old, fresh, abandoned, broken].map(existsSync)).toEqual([false, true, false, true, false, false])
  })

  it('keeps the folder of a run whose process is this one', () => {
    const parent = base()
    run(parent, 'mine', { pid: process.pid, started: Date.now() })
    expect(sweepRuns(parent)).toEqual([])
  })

  it('finds nothing where no run was', () => {
    expect(sweepRuns(join(base(), 'missing'))).toEqual([])
  })
})

describe('the teardown of the run root', () => {
  it('removes the root with its contents', () => {
    const root = createRunRoot(base())
    mkdirSync(join(root, 'nested', 'deeper'), { recursive: true })
    writeFileSync(join(root, 'nested', 'deeper', 'file.txt'), 'x')
    expect(removeRunRoot(root)).toBe(0)
    expect(existsSync(root)).toBe(false)
  })

  // Only Windows refuses to remove a folder that a live process holds as its working directory.
  it.runIf(process.platform === 'win32')('warns with the count of what a live process holds and does not fail', async () => {
    const outer = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
    const teardown = setup()
    const root = tmpdir()
    expect(root).not.toBe(outer.TEMP)
    roots.push(root)
    mkdirSync(join(root, 'held'))
    const child = spawn(process.execPath, ['-e', "process.stdout.write('ready'); setTimeout(() => {}, 60000)"], { cwd: join(root, 'held'), stdio: ['ignore', 'pipe', 'ignore'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // `spawn` comes before the child holds its working directory; its first output comes after.
      await once(child.stdout!, 'data')
      expect(() => teardown()).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toMatch(/^test temp root .+: [1-9]\d* entries left behind, the next run removes them$/)
      expect({ TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }).toEqual(outer)
    } finally {
      warn.mockRestore()
      child.kill()
      await once(child, 'exit')
    }
  })
})
