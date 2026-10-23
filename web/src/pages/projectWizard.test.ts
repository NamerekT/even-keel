import { describe, expect, it } from 'vitest'
import type { ProjectCheck } from '../../../src/state.js'
import {
  draftOfFields,
  EMPTY_FIELDS,
  keyOfFolder,
  keyOfTyped,
  missingOf,
  pickProject,
  readyToAdd,
  shapeOf,
  suggestOfRepo,
  switchProfile,
  trustCommand,
  trustCommandAs,
  typedIn,
  type WizardFields,
} from './projectWizard.js'

const fields = (change: Partial<WizardFields>): WizardFields => ({ ...EMPTY_FIELDS, tracker: 'huly', ...change })

const passed: ProjectCheck = {
  repo: { root: 'D:/Projects/shop', current: 'main', suggested: null, notice: null },
  entry: null,
  yields: [],
  tracker: { ok: true, missing: [], open: 3, openToAll: false, notice: null },
  trusted: true,
  platform: 'win32',
  user: 'svc',
}

describe('trustCommand', () => {
  it('goes to the folder with pushd on Windows, which both cmd and PowerShell 7 run', () => {
    expect(trustCommand('D:\\Projects\\shop', 'win32')).toBe('pushd "D:\\Projects\\shop" && claude')
  })

  it('goes to the folder with cd elsewhere, escaping single quotes', () => {
    expect(trustCommand('/home/me/shop', 'linux')).toBe("cd '/home/me/shop' && claude")
    expect(trustCommand("/home/me/it's", 'darwin')).toBe("cd '/home/me/it'\\''s' && claude")
  })
})

describe('trustCommandAs', () => {
  it("opens claude as the service's user from another user's terminal, with runas on Windows (BTN-310)", () => {
    expect(trustCommandAs('D:\\My Projects\\shop', 'win32', 'svc')).toBe('runas /user:svc "cmd /k cd /d D:\\My Projects\\shop && claude"')
  })

  it('with sudo elsewhere, which keeps the folder, and the home of the user', () => {
    expect(trustCommandAs('/home/me/shop', 'linux', 'even-keel')).toBe("cd '/home/me/shop' && sudo -u 'even-keel' -H claude")
  })
})

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
      milestones: [],
      provider: null,
    })
  })

  it('gives the agent picked, and none for the shared one (BTN-310)', () => {
    expect(draftOfFields(fields({ provider: 'codex' }))?.provider).toBe('codex')
    expect(draftOfFields(fields({ provider: '' }))?.provider).toBeNull()
  })

  it('gives the milestones one per line, blanks dropped (BTN-306)', () => {
    expect(draftOfFields(fields({ milestones: ' v1.0.1 \n\n v1.0.2' }))?.milestones).toEqual(['v1.0.1', 'v1.0.2'])
  })

  it("gives the chosen profile, and none for the kind's default one: the project follows the default then", () => {
    expect(draftOfFields(fields({ profile: 'p-1' }))?.profile).toBe('p-1')
    expect(draftOfFields(fields({ profile: 'p-1' }), true)?.profile).toBeNull()
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

  it('puts the team before the project once the key is not the team', () => {
    const linear = fields({ tracker: 'linear', team: 'NAM', trackerProject: 'GameStore' })
    expect(draftOfFields({ ...linear, key: 'NAM' })?.trackerProject).toBe('GameStore')
    expect(draftOfFields({ ...linear, key: 'GS' })?.trackerProject).toBe('NAM/GameStore')
    expect(draftOfFields({ ...linear, key: 'GS', trackerProject: '' })?.trackerProject).toBe('NAM/')
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
    expect(readyToAdd({ ...passed, repo: { root: null, current: null, suggested: null, notice: null }, tracker: null })).toBe(false)
    expect(readyToAdd({ ...passed, repo: { ...passed.repo, notice: { code: 'wizard.repoTaken', params: { project: 'ABC' } } } })).toBe(false)
    expect(readyToAdd({ ...passed, entry: { code: 'config.projectKey', params: { where: 'projects[1].key', value: 'x' } }, tracker: null })).toBe(false)
    expect(readyToAdd({ ...passed, tracker: null })).toBe(false)
    expect(readyToAdd({ ...passed, tracker: { ok: false, missing: ['HULY_URL'], open: null, openToAll: false, notice: null } })).toBe(false)
  })
})

const github = { name: 'github', title: 'GitHub', projectKey: { key: 'github', example: 'octo-org/example', optional: false, alias: false } }
const linear = { name: 'linear', title: 'Linear', projectKey: { key: 'linear', example: 'Web app', optional: true, alias: false } }
const huly = { name: 'huly', title: 'Huly', projectKey: { key: 'huly', example: 'ABC', optional: true, alias: true } }

describe('shapeOf', () => {
  it('names a project by its key, by its own value, by a key the value narrows, or by a key of its own over the value', () => {
    expect(shapeOf({ name: 'huly', title: 'Huly', projectKey: null })).toBe('key')
    expect(shapeOf(github)).toBe('place')
    expect(shapeOf(linear)).toBe('within')
    expect(shapeOf(huly)).toBe('alias')
    expect(shapeOf(undefined)).toBe('key')
  })
})

describe('pickProject', () => {
  it("takes a Huly project's identifier for the key and its name", () => {
    expect(pickProject(fields({}), 'key', { key: 'STORE', name: 'Storefront' })).toMatchObject({ key: 'STORE', name: 'Storefront' })
  })

  it("takes a Huly project's identifier for the tracker value too, and keeps a key typed by hand", () => {
    expect(pickProject(fields({}), 'alias', { key: 'STORE', name: 'Storefront' })).toMatchObject({ trackerProject: 'STORE', key: 'STORE', name: 'Storefront' })
    const typed = typedIn(fields({}), 'key', 'STORR')
    expect(pickProject(typed, 'alias', { key: 'STORE', name: 'Storefront' })).toMatchObject({ trackerProject: 'STORE', key: 'STORR' })
  })

  it('takes a repository for the tracker value, and the key and the name from its name', () => {
    const picked = pickProject(fields({ tracker: 'github' }), 'place', { key: 'octo-org/storefront', name: 'storefront' })
    expect(picked).toMatchObject({ trackerProject: 'octo-org/storefront', key: 'STO', name: 'storefront' })
  })

  it("takes a team's key, and a project of the team narrows it and names the project", () => {
    expect(pickProject(fields({ tracker: 'linear' }), 'within', { key: 'ENG', name: 'Engineering' })).toMatchObject({ team: 'ENG', key: 'ENG', trackerProject: '', name: 'Engineering' })
    expect(pickProject(fields({ tracker: 'linear' }), 'within', { key: 'ENG', name: 'Web app', within: 'Web app' })).toMatchObject({ team: 'ENG', key: 'ENG', trackerProject: 'Web app', name: 'Web app' })
  })

  it('keeps a key of its own over the team picked', () => {
    const typed = typedIn(fields({ tracker: 'linear' }), 'key', 'GS')
    expect(pickProject(typed, 'within', { key: 'NAM', name: 'GameStore', within: 'GameStore' })).toMatchObject({ team: 'NAM', key: 'GS', trackerProject: 'GameStore' })
  })

  it('keeps what was typed by hand', () => {
    const typed = typedIn(typedIn(fields({ tracker: 'github' }), 'name', 'My shop'), 'key', 'SHOP')
    expect(pickProject(typed, 'place', { key: 'octo-org/storefront', name: 'storefront' })).toMatchObject({ key: 'SHOP', name: 'My shop' })
  })
})

describe('suggestOfRepo', () => {
  const repo = { root: 'D:/Projects/shop', current: 'trunk', suggested: 'octo-org/storefront' }

  it("fills the branch, and on GitHub the remote's repository, a key and a name from it", () => {
    expect(suggestOfRepo(fields({ tracker: 'github' }), 'place', repo)).toMatchObject({ branch: 'trunk', trackerProject: 'octo-org/storefront', key: 'STO', name: 'storefront' })
  })

  it("takes the folder's name without a remote", () => {
    expect(suggestOfRepo(fields({ tracker: 'github' }), 'place', { ...repo, suggested: null })).toMatchObject({ trackerProject: '', key: 'SHO', name: 'shop' })
  })

  it('suggests no key where it is the tracker\'s, and keeps a typed branch and typed fields', () => {
    expect(suggestOfRepo(fields({}), 'key', repo)).toMatchObject({ branch: 'trunk', key: '', name: '' })
    const typed = typedIn(fields({ tracker: 'github', branch: 'dev' }), 'trackerProject', 'octo-org/other')
    expect(suggestOfRepo(typed, 'place', repo)).toMatchObject({ branch: 'dev', trackerProject: 'octo-org/other', key: 'OTH', name: 'other' })
  })
})

describe('switchProfile', () => {
  it("clears the last kind's suggestions, not what was typed", () => {
    const before = typedIn(fields({ tracker: 'github', trackerProject: 'octo-org/shop', name: 'shop' }), 'key', 'SHOP')
    expect(switchProfile(before, { id: 'p-2', kind: 'huly' })).toMatchObject({ profile: 'p-2', tracker: 'huly', key: 'SHOP', name: '', trackerProject: '' })
  })

  it('keeps everything for another profile of the same kind', () => {
    const before = fields({ tracker: 'github', profile: 'p-1', trackerProject: 'octo-org/shop' })
    expect(switchProfile(before, { id: 'p-3', kind: 'github' })).toMatchObject({ profile: 'p-3', trackerProject: 'octo-org/shop' })
  })
})

describe('missingOf', () => {
  const ready = fields({ repo: 'D:/Projects/shop', profile: 'p-1', key: 'SHOP' })

  it('names the first thing missing, in the order of the steps', () => {
    expect(missingOf(fields({}), 'key', null)).toBe('repo')
    expect(missingOf(fields({ repo: 'D:/x' }), 'key', null)).toBe('profile')
    expect(missingOf(fields({ repo: 'D:/x', profile: 'p-1' }), 'place', null)).toBe('place')
    expect(missingOf(fields({ repo: 'D:/x', profile: 'p-1', trackerProject: 'o/n' }), 'place', null)).toBe('key')
    expect(missingOf(fields({ repo: 'D:/x', profile: 'p-1' }), 'key', null)).toBe('project')
    expect(missingOf(ready, 'key', null)).toBe('checking')
  })

  it("names the check's failures, and nothing once it passed", () => {
    const repoNotice = { code: 'wizard.repoTaken', params: { project: 'ABC' } } as const
    expect(missingOf(fields({ repo: 'D:/x' }), 'key', { ...passed, repo: { ...passed.repo, notice: repoNotice } })).toBe('repoError')
    expect(missingOf(ready, 'key', { ...passed, entry: { code: 'config.projectKey', params: { where: 'k', value: 'x' } } })).toBe('entry')
    expect(missingOf(ready, 'key', { ...passed, tracker: { ok: false, missing: [], open: null, openToAll: false, notice: null } })).toBe('tracker')
    expect(missingOf(ready, 'key', { ...passed, tracker: null })).toBe('checking')
    expect(missingOf(ready, 'key', passed)).toBeNull()
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

describe('keyOfTyped', () => {
  it('makes letters capital', () => {
    expect(keyOfTyped('nam')).toBe('NAM')
  })

  it('drops what a key cannot hold, Cyrillic included', () => {
    expect(keyOfTyped('NAMЫ')).toBe('NAM')
    expect(keyOfTyped('ыNAM')).toBe('NAM')
    expect(keyOfTyped('a-b c')).toBe('ABC')
    expect(keyOfTyped('X_1')).toBe('X_1')
  })

  it('starts with a letter', () => {
    expect(keyOfTyped('1AB')).toBe('AB')
    expect(keyOfTyped('_9')).toBe('')
  })

  it('keeps at most five characters', () => {
    expect(keyOfTyped('abcdefg')).toBe('ABCDE')
  })
})
