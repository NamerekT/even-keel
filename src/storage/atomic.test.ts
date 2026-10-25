import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeAtomic } from './atomic.js'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

describe('writeAtomic', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  let dir: string
  let file: string
  let now: number

  beforeEach(() => {
    mkdirSync('.temp', { recursive: true })
    dir = mkdtempSync(join('.temp', 'atomic-'))
    file = join(dir, 'state.json')
    writeFileSync(file, 'old')
    now = 0
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.spyOn(Atomics, 'wait').mockImplementation((_array, _index, _value, timeout) => {
      now += timeout ?? 0
      return 'timed-out'
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform)
    vi.restoreAllMocks()
    vi.mocked(renameSync).mockReset()
    rmSync(dir, { recursive: true, force: true })
  })

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a transient %s and replaces the whole file', (code) => {
    const error = Object.assign(new Error('locked'), { code })
    vi.mocked(renameSync).mockImplementationOnce(() => { throw error }).mockImplementationOnce(() => { throw error })

    writeAtomic(file, 'new')

    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(renameSync).toHaveBeenCalledTimes(3)
    expect(Atomics.wait).toHaveBeenCalledTimes(2)
    expect(now).toBeGreaterThan(0)
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
  })

  it('stops retrying after three seconds, keeps the original file and removes the temporary file', () => {
    const error = Object.assign(new Error('still locked'), { code: 'EPERM' })
    vi.mocked(renameSync).mockImplementation(() => { throw error })

    expect(() => writeAtomic(file, 'new')).toThrow(error)
    expect(now).toBe(3000)
    expect(readFileSync(file, 'utf8')).toBe('old')
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
    expect(vi.mocked(Atomics.wait).mock.calls.every((call) => call[3]! <= 100)).toBe(true)
  })

  it.each([
    ['win32', 'ENOENT'],
    ['win32', 'ENOSPC'],
    ['linux', 'EPERM'],
    ['darwin', 'EACCES'],
  ])('does not retry %s %s', (os, code) => {
    Object.defineProperty(process, 'platform', { value: os })
    const error = Object.assign(new Error('cannot rename'), { code })
    vi.mocked(renameSync).mockImplementationOnce(() => { throw error })

    expect(() => writeAtomic(file, 'new')).toThrow(error)
    expect(renameSync).toHaveBeenCalledTimes(1)
    expect(Atomics.wait).not.toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe('old')
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
  })
})
