import { afterEach, describe, expect, it } from 'vitest'
import type { EvenKeelState, RemoteBranchList, RepoBranches } from '../../../src/state.js'
import { branchTexts } from '../i18n/branch.js'
import { setLanguage } from '../i18n/index.js'
import { fakeRepoBranches } from '../live/fakeBranches.js'
import { branchOffers, cloneLine, moveLine, remoteOffers } from './branchLines.js'

const repo: RepoBranches = {
  current: 'dev',
  head: 'a1b2c3d',
  branches: [
    { name: 'dev', remote: null },
    { name: 'main', remote: null },
    { name: 'release/v1', remote: 'origin' },
  ],
}

afterEach(() => setLanguage('en'))

describe('branchOffers', () => {
  it('marks the checkout\'s branch and a branch only on a remote, keeping the server\'s order', () => {
    expect(branchOffers(repo)).toEqual([
      { value: 'dev', label: 'in the folder now' },
      { value: 'main' },
      { value: 'release/v1', label: 'on origin' },
    ])
  })

  it('leaves out the hidden branches', () => {
    const withTasks: RepoBranches = {
      ...repo,
      branches: [...repo.branches, { name: 'abc-1/task', remote: null, hidden: true }, { name: 'abc-2/task', remote: 'origin', hidden: true }],
    }
    expect(branchOffers(withTasks).map((offer) => offer.value)).toEqual(['dev', 'main', 'release/v1'])
  })

  it('offers no task branches on dev:fake', () => {
    const state = { branchDrift: {}, config: { projects: {} } } as unknown as EvenKeelState
    const values = branchOffers(fakeRepoBranches(state, 'ABC')).map((offer) => offer.value)
    expect(values).toContain('develop')
    expect(values.some((value) => value.endsWith('/task'))).toBe(false)
  })

  it('offers nothing while the branches are not read', () => {
    expect(branchOffers(null)).toEqual([])
  })

  it('marks no branch on a detached HEAD', () => {
    expect(branchOffers({ ...repo, current: null }).map((offer) => offer.label)).toEqual([undefined, undefined, 'on origin'])
  })
})

describe('moveLine', () => {
  it('says the checkout goes over to a local branch', () => {
    expect(moveLine(repo, 'main')).toBe('The checkout will go from dev to main')
  })

  it('says a branch nowhere is created from the checkout\'s branch and sha', () => {
    expect(moveLine(repo, ' feature/x ')).toBe('There is no branch feature/x: it will be created from dev (a1b2c3d), and the checkout will go to it')
  })

  it('says a branch only on a remote is taken from there', () => {
    expect(moveLine(repo, 'release/v1')).toBe('The branch release/v1 will be taken from origin, and the checkout will go to it')
  })

  it('says nothing for the checkout\'s own branch, a blank field or branches not read', () => {
    expect(moveLine(repo, 'dev')).toBeNull()
    expect(moveLine(repo, '  ')).toBeNull()
    expect(moveLine(null, 'main')).toBeNull()
  })

  it('names a detached HEAD as the start of a new branch', () => {
    expect(moveLine({ ...repo, current: null }, 'feature/x')).toBe('There is no branch feature/x: it will be created from the current HEAD (a1b2c3d), and the checkout will go to it')
  })

  it('speaks Russian on a Russian page', () => {
    setLanguage('ru')
    expect(moveLine(repo, 'main')).toBe('Чекаут перейдёт с dev на main')
    expect(moveLine(repo, 'feature/x')).toBe('Ветки feature/x нет: она будет создана от dev (a1b2c3d), чекаут перейдёт на неё')
  })
})

describe('the drift warning', () => {
  it('names the folder\'s branch and the project\'s, and a detached HEAD as such', () => {
    expect(branchTexts().drift('feature/spike', 'main')).toBe("The folder is on feature/spike now, the project's main branch is main")
    setLanguage('ru')
    expect(branchTexts().drift(null, 'main')).toBe('В папке сейчас отсоединённый HEAD, главная ветка проекта — main')
    expect(branchTexts().adopt('feature/spike')).toBe('Сделать feature/spike главной')
    expect(branchTexts().restore('main')).toBe('Вернуть папку на main')
  })
})

describe('a clone\'s branch field (BTN-1096)', () => {
  const list: RemoteBranchList = { head: 'main', branches: ['main', 'develop'], total: 2, typed: 'develop', has: true }

  it('offers the remote\'s branches, the default marked so', () => {
    expect(remoteOffers(list)).toEqual([{ value: 'main', label: 'default' }, { value: 'develop' }])
  })

  it('says which branch is cloned, and that a branch the remote lacks is created from the default', () => {
    expect(cloneLine(list, 'develop')).toBe('The branch develop will be cloned')
    expect(cloneLine(list, ' main ')).toBe('The branch main will be cloned')
    expect(cloneLine({ ...list, typed: 'next', has: false }, 'next')).toBe('The remote has no branch next: main will be cloned, and next created from it')
    expect(cloneLine({ ...list, head: null, branches: [], total: 0, typed: 'next', has: false }, 'next')).toBe('The remote is empty: the branch next will be created in the clone')
    expect(cloneLine(list, '')).toBeNull()
  })

  it('reads a full list itself while the check is behind the typing, and says nothing for a narrowed one', () => {
    expect(cloneLine(list, 'feature')).toBe('The remote has no branch feature: main will be cloned, and feature created from it')
    const narrowed = { ...list, total: 4000 }
    expect(cloneLine(narrowed, 'feature')).toBeNull()
    expect(cloneLine(narrowed, 'develop')).toBe('The branch develop will be cloned')
  })
})
