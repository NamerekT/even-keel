import { describe, expect, it } from 'vitest'
import { globalPrefixOf } from './prefix.js'
import { leftRunning, packageBlock, previousOf, recordOf, resultView, sameStorage, tagOf, updateBlock, type UpdateRecord } from './model.js'

const STORAGE = { schema: 9, database: 11, tally: 5 }
const CLEAN = { commit: 'a1b2c3d', branch: 'main', tags: ['v0.2.0'], dirty: false }

const RECORD: UpdateRecord = {
  mode: 'update',
  from: { version: '0.1.0', commit: 'f00ba47', branch: 'main', tag: 'v0.1.0', storage: STORAGE },
  to: { version: '0.2.0', tag: 'v0.2.0' },
  startedAt: '2026-10-22T10:00:00.000Z',
  finishedAt: '2026-10-22T10:03:00.000Z',
  failed: null,
  rollback: null,
  seen: false,
}

describe('globalPrefixOf', () => {
  it('finds the prefix of a global install', () => {
    expect(globalPrefixOf('C:\\Users\\john\\AppData\\Roaming\\npm\\node_modules\\even-keel', 'win32')).toBe('C:\\Users\\john\\AppData\\Roaming\\npm')
    expect(globalPrefixOf('/usr/local/lib/node_modules/even-keel', 'linux')).toBe('/usr/local')
    expect(globalPrefixOf('/Users/john/.nvm/versions/node/v24.1.0/lib/node_modules/even-keel', 'darwin')).toBe('/Users/john/.nvm/versions/node/v24.1.0')
  })

  it('has none for a local install or the cache of npx', () => {
    expect(globalPrefixOf('/home/john/tools/node_modules/even-keel', 'linux')).toBeNull()
    expect(globalPrefixOf('/home/john/.npm/_npx/1a2b3c/node_modules/even-keel', 'linux')).toBeNull()
    expect(globalPrefixOf('C:\\Users\\john\\AppData\\Local\\npm-cache\\_npx\\1a2b3c\\node_modules\\even-keel', 'win32')).toBeNull()
    expect(globalPrefixOf('/home/john/even-keel', 'linux')).toBeNull()
  })
})

describe('packageBlock', () => {
  it('needs a global install run by a service manager', () => {
    expect(packageBlock(true, '/usr/local')).toBeNull()
    expect(packageBlock(false, '/usr/local')).toBe('service')
    expect(packageBlock(true, null)).toBe('global')
  })
})

describe('updateBlock', () => {
  it('lets a clean checkout on the tag of the installed version update', () => {
    expect(updateBlock(true, CLEAN, '0.2.0')).toBeNull()
    expect(updateBlock(true, { ...CLEAN, branch: null, tags: ['nightly', '0.2.0'] }, '0.2.0')).toBeNull()
  })

  it('names why there is no button', () => {
    expect(updateBlock(true, undefined, '0.2.0')).toBe('checking')
    expect(updateBlock(true, null, '0.2.0')).toBe('git')
    expect(updateBlock(false, CLEAN, '0.2.0')).toBe('service')
    expect(updateBlock(true, { ...CLEAN, dirty: true }, '0.2.0')).toBe('dirty')
  })

  it('refuses a checkout ahead of the tag or on another version tag', () => {
    expect(updateBlock(true, { ...CLEAN, tags: [] }, '0.2.0')).toBe('tag')
    expect(updateBlock(true, { ...CLEAN, tags: ['v0.1.0'] }, '0.2.0')).toBe('tag')
    expect(updateBlock(true, { ...CLEAN, tags: ['v0.2.0-rc.1'] }, '0.2.0')).toBe('tag')
  })

  it('reads the tag of the installed version', () => {
    expect(tagOf(CLEAN, '0.2.0')).toBe('v0.2.0')
    expect(tagOf({ ...CLEAN, tags: ['v0.1.0'] }, '0.2.0')).toBeNull()
  })
})

describe('previousOf', () => {
  it('offers the version a finished update came from while the storage is the same', () => {
    expect(previousOf(RECORD, '0.2.0', STORAGE, null)).toEqual({ version: '0.1.0', blocked: null })
  })

  it('explains that the storage changed', () => {
    expect(previousOf(RECORD, '0.2.0', { ...STORAGE, schema: 10 }, null)).toEqual({ version: '0.1.0', blocked: 'storage' })
    expect(previousOf(RECORD, '0.2.0', { ...STORAGE, tally: 6 }, null)?.blocked).toBe('storage')
    expect(previousOf({ ...RECORD, from: { ...RECORD.from, storage: null } }, '0.2.0', STORAGE, null)?.blocked).toBe('storage')
  })

  it('passes on why the checkout cannot move', () => {
    expect(previousOf(RECORD, '0.2.0', STORAGE, 'dirty')).toEqual({ version: '0.1.0', blocked: 'dirty' })
  })

  it('offers nothing without a finished update to the installed version from an older one', () => {
    expect(previousOf(null, '0.2.0', STORAGE, null)).toBeNull()
    expect(previousOf(RECORD, '0.3.0', STORAGE, null)).toBeNull()
    expect(previousOf({ ...RECORD, failed: { step: 'build', output: '' }, rollback: { failed: null } }, '0.2.0', STORAGE, null)).toBeNull()
    expect(previousOf({ ...RECORD, mode: 'rebuild', to: null }, '0.2.0', STORAGE, null)).toBeNull()
    const reverted = { ...RECORD, mode: 'revert' as const, from: { ...RECORD.from, version: '0.3.0', tag: 'v0.3.0' } }
    expect(previousOf(reverted, '0.2.0', STORAGE, null)).toBeNull()
    expect(previousOf({ ...RECORD, from: { ...RECORD.from, tag: null } }, '0.2.0', STORAGE, null)).toBeNull()
  })
})

describe('sameStorage', () => {
  it('compares every number', () => {
    expect(sameStorage(STORAGE, { ...STORAGE })).toBe(true)
    expect(sameStorage(STORAGE, { ...STORAGE, database: 12 })).toBe(false)
    expect(sameStorage(null, STORAGE)).toBe(false)
  })
})

describe('recordOf', () => {
  it('reads a record as it was written', () => {
    expect(recordOf(JSON.parse(JSON.stringify(RECORD)))).toEqual(RECORD)
  })

  it('reads a failure with its rollback', () => {
    const failed = { ...RECORD, failed: { step: 'answer', output: 'no answer' }, rollback: { failed: { step: 'build', output: 'tsc' } } }
    expect(recordOf(failed)).toEqual(failed)
  })

  it('drops what it cannot read and fills what a newer writer left out', () => {
    expect(recordOf(null)).toBeNull()
    expect(recordOf({ mode: 'upgrade' })).toBeNull()
    expect(recordOf({ ...RECORD, from: { version: '0.1.0' } })).toBeNull()
    const { seen: _, ...unseen } = RECORD
    expect(recordOf({ ...unseen, failed: { step: 'teleport', output: 1 } })).toEqual({ ...RECORD, failed: { step: 'teleport', output: '' } })
  })
})

describe('resultView', () => {
  it('shows an unseen update or revert, not a rebuild', () => {
    expect(resultView(RECORD)).toEqual({
      mode: 'update',
      from: '0.1.0',
      to: '0.2.0',
      at: RECORD.finishedAt,
      step: null,
      output: '',
      rollback: 'none',
      rollbackStep: null,
    })
    expect(resultView({ ...RECORD, seen: true })).toBeNull()
    expect(resultView({ ...RECORD, mode: 'rebuild' })).toBeNull()
    expect(resultView(null)).toBeNull()
  })

  it('names the failed step and how the rollback went', () => {
    const failed = { ...RECORD, failed: { step: 'build' as const, output: 'error TS2304' }, rollback: { failed: null } }
    expect(resultView(failed)).toMatchObject({ step: 'build', output: 'error TS2304', rollback: 'done', rollbackStep: null })
    const broken = { ...failed, rollback: { failed: { step: 'install' as const, output: 'EPERM' } } }
    expect(resultView(broken)).toMatchObject({ rollback: 'failed', rollbackStep: 'install', output: 'error TS2304\n\nEPERM' })
  })
})

describe('leftRunning', () => {
  it('holds a record only on the version it left running', () => {
    expect(leftRunning(RECORD, '0.2.0')).toBe(true)
    expect(leftRunning(RECORD, '0.1.0')).toBe(false)
    const revert = { ...RECORD, mode: 'revert' as const, from: { ...RECORD.from, version: '0.2.0' }, to: { version: '0.1.0', tag: 'v0.1.0' } }
    expect(leftRunning(revert, '0.1.0')).toBe(true)
    expect(leftRunning(revert, '0.2.0')).toBe(false)
  })

  it('takes a failed run as one that left the version it came from', () => {
    const rolledBack = { ...RECORD, failed: { step: 'build' as const, output: '' }, rollback: { failed: null } }
    expect(leftRunning(rolledBack, '0.1.0')).toBe(true)
    expect(leftRunning(rolledBack, '0.2.0')).toBe(false)
    const early = { ...RECORD, failed: { step: 'stop' as const, output: '' } }
    expect(leftRunning(early, '0.1.0')).toBe(true)
  })

  it('keeps a failed rollback on either version and drops it on a third', () => {
    const broken = { ...RECORD, failed: { step: 'build' as const, output: '' }, rollback: { failed: { step: 'install' as const, output: '' } } }
    expect(leftRunning(broken, '0.1.0')).toBe(true)
    expect(leftRunning(broken, '0.2.0')).toBe(true)
    expect(leftRunning(broken, '0.3.0')).toBe(false)
  })

  it('keeps a rebuild whatever runs', () => {
    expect(leftRunning({ ...RECORD, mode: 'rebuild', to: null }, '0.3.0')).toBe(true)
  })
})
