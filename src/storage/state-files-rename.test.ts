import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { causeLine, NoticeError, noticeWithCause } from '../notice/notice.js'
import { databaseDirOf } from './owner.js'
import { prepareDatabase } from './state-files.js'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

// The very first start of a fresh install was blocked once by a rename of the new database's folder (BTN-674).
describe('moving a new database into place', { timeout: 120_000 }, () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  let dir: string
  let stateDir: string
  let refusals: number

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-rename-'))
    stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
    const real = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (to === databaseDirOf(stateDir) && refusals-- > 0) {
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`), { code: 'EPERM' })
      }
      real(from, to)
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform)
    vi.restoreAllMocks()
    vi.mocked(renameSync).mockReset()
    rmSync(dir, { recursive: true, force: true })
  })

  const prepare = () => prepareDatabase({ stateDir, log: () => {} })

  it('retries a folder a scanner holds for a moment', async () => {
    refusals = 1
    await (await prepare()).close()
    expect(existsSync(databaseDirOf(stateDir))).toBe(true)
    expect(existsSync(`${databaseDirOf(stateDir)}.import`)).toBe(false)
  })

  it('gives up on a folder that stays locked and says why', async () => {
    refusals = Infinity
    let waited = 0
    const start = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => start + waited)
    vi.mocked(Atomics.wait).mockImplementation((_array, _index, _value, timeout) => {
      waited += timeout ?? 0
      return 'timed-out'
    })
    const error = await prepare().then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(NoticeError)
    expect(noticeWithCause(error)).toMatchObject({ code: 'storage.importFailed', detail: expect.stringContaining('EPERM: operation not permitted, rename') })
    expect(causeLine(error)).toMatch(/^cause: EPERM: operation not permitted, rename '.*even-keel\.import' -> '.*even-keel'$/)
    expect(waited).toBe(3000)
    expect(existsSync(databaseDirOf(stateDir))).toBe(false)
    expect(existsSync(`${databaseDirOf(stateDir)}.import`)).toBe(false)
  })
})
