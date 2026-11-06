import { afterEach, describe, expect, it } from 'vitest'
import type { EvenKeelState, RepoBranches } from '../../../src/state.js'
import { branchTexts } from '../i18n/branch.js'
import { setLanguage } from '../i18n/index.js'
import { fakeRepoBranches } from '../live/fakeBranches.js'
import { branchOffers, moveLine } from './branchLines.js'

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
