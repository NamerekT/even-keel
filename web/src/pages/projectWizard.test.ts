import { describe, expect, it } from 'vitest'
import type { ProjectCheck } from '../../../src/state.js'
import { draftOfFields, EMPTY_FIELDS, keyOfFolder, readyToAdd, type WizardFields } from './projectWizard.js'

const fields = (change: Partial<WizardFields>): WizardFields => ({ ...EMPTY_FIELDS, tracker: 'huly', ...change })

const passed: ProjectCheck = {
  repo: { root: 'D:/Projects/shop', current: 'main', notice: null },
  entry: null,
  tracker: { ok: true, missing: [], open: 3, notice: null },
  trusted: true,
}

describe('draftOfFields', () => {
  it('trims the texts and gives a worktree per task as slot 0', () => {
    expect(draftOfFields(fields({ repo: ' D:/Projects/shop ', key: ' SHOP ', name: ' Shop ', branch: ' main ', trackerProject: ' org/shop ' }))).toEqual({
      repo: 'D:/Projects/shop',
      branch: 'main',
      key: 'SHOP',
      name: 'Shop',
      tracker: 'huly',
      trackerProject: 'org/shop',
      profile: null,
      slot: 0,
    })
  })

  it('gives the chosen profile, and none for the default one', () => {
    expect(draftOfFields(fields({ profile: 'p-1' }))?.profile).toBe('p-1')
    expect(draftOfFields(fields({ profile: '' }))?.profile).toBeNull()
  })

  it('gives the pool size for slots', () => {
    expect(draftOfFields(fields({ place: 'slots', slots: '3' }))?.slot).toBe(3)
  })

  it('refuses a pool that is not a whole number above zero', () => {
    expect(draftOfFields(fields({ place: 'slots', slots: '0' }))).toBeUndefined()
    expect(draftOfFields(fields({ place: 'slots', slots: '1.5' }))).toBeUndefined()
    expect(draftOfFields(fields({ place: 'slots', slots: '' }))).toBeUndefined()
  })

  it('ignores the pool size while each task gets its own worktree', () => {
    expect(draftOfFields(fields({ place: 'worktree', slots: 'x' }))?.slot).toBe(0)
  })
})

describe('readyToAdd', () => {
  it('is ready once the repository, the entry and the tracker pass', () => {
    expect(readyToAdd(passed)).toBe(true)
  })

  it('does not wait for the trust: the chain can start once the folder is trusted later', () => {
    expect(readyToAdd({ ...passed, trusted: false })).toBe(true)
  })

  it('is not ready without a check, a repository, with a bad entry or a tracker that did not answer', () => {
    expect(readyToAdd(null)).toBe(false)
    expect(readyToAdd({ ...passed, repo: { root: null, current: null, notice: null }, tracker: null })).toBe(false)
    expect(readyToAdd({ ...passed, repo: { ...passed.repo, notice: { code: 'wizard.repoTaken', params: { project: 'ABC' } } } })).toBe(false)
    expect(readyToAdd({ ...passed, entry: { code: 'config.projectKey', params: { where: 'projects[1].key', value: 'x' } }, tracker: null })).toBe(false)
    expect(readyToAdd({ ...passed, tracker: null })).toBe(false)
    expect(readyToAdd({ ...passed, tracker: { ok: false, missing: ['HULY_URL'], open: null, notice: null } })).toBe(false)
  })
})

describe('keyOfFolder', () => {
  it('takes the initials of a folder of several words', () => {
    expect(keyOfFolder('D:/Projects/git/even-keel')).toBe('EK')
    expect(keyOfFolder('/home/john/my_cool_app')).toBe('MCA')
  })

  it('takes the first letters of a folder of one word', () => {
    expect(keyOfFolder('D:\\Projects\\storefront')).toBe('STO')
    expect(keyOfFolder('/srv/ab/')).toBe('AB')
  })

  it('starts with a letter and keeps at most five characters', () => {
    expect(keyOfFolder('/srv/2048-game')).toBe('GAM')
    expect(keyOfFolder('/srv/a-b-c-d-e-f-g')).toBe('ABCDE')
  })

  it('gives nothing for a folder without letters', () => {
    expect(keyOfFolder('/srv/2048')).toBe('')
    expect(keyOfFolder('')).toBe('')
  })
})
