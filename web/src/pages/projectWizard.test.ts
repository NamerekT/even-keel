import { describe, expect, it } from 'vitest'
import type { Notice } from '../../../src/notice/notice.js'
import type { ProjectCheck } from '../../../src/state.js'
import {
  draftOfFields,
  entryField,
  EMPTY_FIELDS,
  keyOfFolder,
  keyOfTyped,
  missingOf,
  pickProject,
  placeFields,
  placeOf,
  readyToAdd,
  shapeOf,
  stepChecks,
  suggestOfRepo,
  switchProfile,
  taskExample,
  trackerPlace,
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

describe('taskExample', () => {
  it('names a task by the key and its branch in lower case', () => {
    expect(taskExample('key', fields({ key: 'ABC' }))).toBe('ABC-12 → abc-12/task')
  })

  it('starts from the issue number where the key is a free prefix', () => {
    expect(taskExample('place', fields({ key: 'SHOP', trackerProject: 'octo-org/shop' }))).toBe('#12 → SHOP-12 → shop-12/task')
  })

  it('keeps the tracker\'s ids where they are not the key', () => {
    expect(taskExample('within', fields({ key: 'WEB', team: 'ENG' }))).toBe('ENG-12 → eng-12/task')
  })

  it('has no example without a key', () => {
    expect(taskExample('key', fields({}))).toBeNull()
  })
})

describe('trackerPlace', () => {
  it('names the tracker\'s project as each kind does', () => {
    expect(trackerPlace('key', fields({ key: 'ABC' }))).toBe('ABC')
    expect(trackerPlace('place', fields({ key: 'SHOP', trackerProject: ' octo-org/shop ' }))).toBe('octo-org/shop')
    expect(trackerPlace('within', fields({ key: 'WEB', team: 'ENG', trackerProject: 'Web app' }))).toBe('ENG / Web app')
    expect(trackerPlace('within', fields({ key: 'ENG' }))).toBe('ENG')
    expect(trackerPlace('place', fields({}))).toBe('')
  })
})

describe('stepChecks', () => {
  const typed = fields({ repo: 'D:/Projects/shop', profile: 'p1', key: 'ABC' })
  const notice: Notice = { code: 'wizard.keyTaken', params: { key: 'ABC', project: 'Shop' } }

  it('passes every step once the check passed and the agent is ready', () => {
    expect(stepChecks(typed, 'key', passed, passed, 'passed')).toEqual({ agent: 'passed', repo: 'passed', tracker: 'passed', project: 'passed', place: 'passed' })
  })

  it('leaves the steps not typed yet empty, the folder\'s too while it is checked', () => {
    expect(stepChecks(fields({}), 'key', null, null, 'empty')).toEqual({ agent: 'empty', repo: 'empty', tracker: 'empty', project: 'empty', place: 'passed' })
    expect(stepChecks(typed, 'key', null, null, 'passed').repo).toBe('empty')
  })

  it('fails the folder on its notice and the tracker on its answer', () => {
    const noBranch: Notice = { code: 'wizard.noBranch', params: { branch: 'x', branches: [] } }
    const repoRefused = { ...passed, repo: { ...passed.repo, notice: noBranch } }
    expect(stepChecks(typed, 'key', repoRefused, repoRefused, 'passed').repo).toBe('failed')
    const failed: Notice = { code: 'wizard.trackerFailed', params: { tracker: 'Huly' } }
    const trackerRefused = { ...passed, tracker: { ok: false, missing: [], open: null, openToAll: false, notice: failed } }
    expect(stepChecks(typed, 'key', trackerRefused, trackerRefused, 'passed').tracker).toBe('failed')
  })

  it('fails the step whose field the entry refused: the key typed, or the tracker\'s project that is the key', () => {
    const refused = { ...passed, entry: notice, tracker: null }
    expect(stepChecks(typed, 'alias', refused, refused, 'passed')).toMatchObject({ tracker: 'empty', project: 'failed' })
    expect(stepChecks(typed, 'key', refused, refused, 'passed')).toMatchObject({ tracker: 'failed', project: 'empty' })
  })

  it('fails the project step on milestones a shared tracker project needs, whatever names the key', () => {
    const entry: Notice = { code: 'wizard.trackerShared', params: { project: 'Shop' } }
    const shared = { ...passed, entry, tracker: null }
    expect(stepChecks(typed, 'key', shared, shared, 'passed').project).toBe('failed')
  })

  it.each(['place', 'alias', 'within'] as const)('fails Tracker for a tracker place refusal on %s, leaving Project empty', (shape) => {
    const entered = { ...typed, team: 'ENG', trackerProject: 'invalid' }
    const entry: Notice = { code: 'wizard.trackerPlace', params: { example: 'group/subgroup/project' } }
    const refused = { ...passed, entry, tracker: null }
    expect(stepChecks(entered, shape, refused, refused, 'passed')).toMatchObject({ tracker: 'failed', project: 'empty' })
    expect(entryField(entered, shape, entry)).toBe('tracker')
  })

  it('fails Project only for key refusals when the prefix is a separate field', () => {
    const entry: Notice = { code: 'wizard.keyShape', params: { value: 'invalid' } }
    const refused = { ...passed, entry, tracker: null }
    expect(stepChecks(typed, 'place', refused, refused, 'passed')).toMatchObject({ tracker: 'empty', project: 'failed' })
    expect(entryField(typed, 'place', entry)).toBe('key')
    expect(entryField(typed, 'place', notice)).toBe('key')
    expect(entryField(typed, 'key', entry)).toBe('tracker')
  })

  it.each(['place', 'alias', 'within', 'key'] as const)('leaves a blank tracker project empty on %s and names it in the footer', (shape) => {
    const entered = { ...typed, repo: 'D:/Projects/shop', key: shape === 'key' ? '' : 'CC' }
    const entry: Notice = { code: 'wizard.trackerPlace', params: { example: 'group/subgroup/project' } }
    const refused = { ...passed, entry, tracker: null }
    expect(stepChecks(entered, shape, refused, refused, 'passed')).toMatchObject({ tracker: 'empty', project: 'empty' })
    expect(entryField(entered, shape, entry)).toBeNull()
    expect(missingOf(entered, shape, refused)).toBe(shape === 'place' ? 'place' : 'project')
  })

  it('keeps blank keys quiet, shared milestones on Project, and other entry failures away from the prefix', () => {
    expect(entryField({ ...typed, key: ' ' }, 'place', notice)).toBeNull()
    expect(entryField(typed, 'place', { code: 'wizard.trackerShared', params: { project: 'Shop' } })).toBe('milestones')
    expect(entryField(typed, 'place', { code: 'wizard.entryFailed', params: {} })).toBe('tracker')
    expect(entryField(typed, 'place', null)).toBeNull()
  })

  it('fails the folders on a pool that is not a whole number above zero', () => {
    expect(stepChecks({ ...typed, place: 'slots', slots: '0' }, 'key', passed, passed, 'passed').place).toBe('failed')
    expect(stepChecks({ ...typed, place: 'slots', slots: '3' }, 'key', passed, passed, 'passed').place).toBe('passed')
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

describe('placeFields', () => {
  it("splits a within tracker's value into its team and project, the team blank while it is the key's", () => {
    expect(placeFields('within', 'WEB', 'ENG/Web app')).toEqual({ team: 'ENG', trackerProject: 'Web app' })
    expect(placeFields('within', 'WEB', 'ENG/')).toEqual({ team: 'ENG', trackerProject: '' })
    expect(placeFields('within', 'WEB', 'Web app')).toEqual({ team: '', trackerProject: 'Web app' })
  })

  it('takes the whole value as the tracker project on other shapes', () => {
    expect(placeFields('alias', 'ABC', 'XYZ')).toEqual({ team: '', trackerProject: 'XYZ' })
    expect(placeFields('place', 'SHOP', 'octo-org/shop')).toEqual({ team: '', trackerProject: 'octo-org/shop' })
  })

  it('gives back the value it split', () => {
    for (const value of ['ENG/Web app', 'ENG/', 'Web app', '']) expect(placeOf(fields({ key: 'WEB', ...placeFields('within', 'WEB', value) }))).toBe(value)
  })
})

describe('placeOf', () => {
  it('leaves the team out once it is the key', () => {
    expect(placeOf(fields({ key: 'WEB', team: 'WEB', trackerProject: 'Web app' }))).toBe('Web app')
    expect(placeOf(fields({ key: 'WEB', team: ' ENG ', trackerProject: 'Web app' }))).toBe('ENG/Web app')
  })

  it('keeps the project as typed, a space being typed included', () => {
    expect(placeOf(fields({ key: 'WEB', team: 'ENG', trackerProject: 'Web ' }))).toBe('ENG/Web ')
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
