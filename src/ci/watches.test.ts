import { describe, expect, it, vi } from 'vitest'
import type { CiSource } from './model.js'
import type { CiTarget } from './remote.js'
import { CiWatches } from './watches.js'

const target = (repo: string): CiTarget => ({ kind: 'forgejo', remote: 'origin', web: 'https://forgejo.example.com', owner: 'john', repo })

function context() {
  const made: { project: string; repo: string; hidden: boolean; sources: (CiSource | null)[] }[] = []
  let token: string | null = null
  const asked: string[] = []
  const watches = new CiWatches({
    targets: async (repo) => (repo.endsWith('none') ? [] : [target(repo)]),
    watch: (project, repo) => {
      const watch = {
        project,
        repo,
        hidden: false,
        sources: [] as (CiSource | null)[],
        setSource: (source: CiSource | null) => watch.sources.push(source),
        tick: vi.fn(async () => {}),
      }
      made.push(watch)
      return watch
    },
    source: (project) => {
      asked.push(project)
      return token === null ? null : { runs: async () => [], jobs: async () => [] }
    },
    log: () => {},
  })
  return { watches, made, asked, setToken: (next: string | null) => (token = next) }
}

describe('CiWatches', () => {
  it('watches the projects with a CI and is found once all are read', async () => {
    const { watches } = context()
    const applied = watches.apply({ ABC: 'D:/abc', XYZ: 'D:/none' })
    expect(watches.found).toBe(false)
    await applied
    expect(watches.found).toBe(true)
    expect([...watches.byProject.keys()]).toEqual(['ABC'])
  })

  it('adds a project, drops a removed one and watches anew one whose repository moved', async () => {
    const { watches, made } = context()
    await watches.apply({ ABC: 'D:/abc', XYZ: 'D:/xyz' })
    await watches.apply({ ABC: 'D:/abc2', NEW: 'D:/new' })
    expect([...watches.byProject.keys()].sort()).toEqual(['ABC', 'NEW'])
    expect(watches.byProject.get('ABC')![0]).toMatchObject({ repo: 'D:/abc2' })
    expect(made).toHaveLength(4)
  })

  it('rereads the remotes of the same repository: a changed list adds and drops watches, the same one touches nothing', async () => {
    const remotes: Record<string, CiTarget[]> = { 'D:/abc': [], 'D:/xyz': [target('xyz')] }
    const made: CiTarget[] = []
    const log = vi.fn()
    const watches = new CiWatches({
      targets: async (repo) => remotes[repo]!,
      watch: (_project, _repo, place) => {
        made.push(place)
        return { hidden: false, place, setSource: () => {}, tick: vi.fn(async () => {}) }
      },
      source: () => null,
      log,
    })
    await watches.apply({ ABC: 'D:/abc', XYZ: 'D:/xyz' })
    const kept = watches.byProject.get('XYZ')![0]!
    log.mockClear()

    expect(await watches.refresh()).toBe(false)
    expect(made).toHaveLength(1)
    expect(log).not.toHaveBeenCalled()

    const github: CiTarget = { kind: 'github', remote: 'github', web: 'https://github.com', owner: 'john', repo: 'abc' }
    remotes['D:/abc'] = [github]
    remotes['D:/xyz'] = []
    expect(await watches.refresh()).toBe(true)
    expect(watches.found).toBe(true)
    expect(watches.byProject.get('ABC')!.map((watch) => watch.place)).toEqual([github])
    expect(watches.byProject.has('XYZ')).toBe(false)
    expect(watches.places(false)).toEqual([{ project: 'ABC', target: github }])
    expect(log).toHaveBeenCalledWith('ci: ABC watches github on github')

    remotes['D:/xyz'] = [target('xyz'), github]
    await watches.refresh()
    expect(watches.byProject.get('XYZ')!.map((watch) => watch.place)).toEqual([target('xyz'), github])
    expect(watches.byProject.get('XYZ')![0]).not.toBe(kept)
    const again = watches.byProject.get('XYZ')!
    remotes['D:/xyz'] = [github]
    await watches.refresh()
    expect(watches.byProject.get('XYZ')).toEqual([again[1]])
  })

  it('keeps the watches of a repository whose remotes are not read on a refresh', async () => {
    let fail = false
    const watches = new CiWatches({
      targets: async (repo) => {
        if (fail) throw new Error('git is gone')
        return [target(repo)]
      },
      watch: () => ({ hidden: false, setSource: () => {}, tick: vi.fn(async () => {}) }),
      source: () => null,
      log: () => {},
    })
    await watches.apply({ ABC: 'D:/abc' })
    fail = true
    await watches.refresh()
    expect(watches.byProject.get('ABC')).toHaveLength(1)
  })

  it('gives every watch the source of the new token of its project', async () => {
    const { watches, made, asked, setToken } = context()
    await watches.apply({ ABC: 'D:/abc' })
    setToken('t')
    watches.tokensChanged()
    expect(made[0]!.sources).toHaveLength(1)
    expect(made[0]!.sources[0]).not.toBeNull()
    expect(asked).toEqual(['ABC'])
  })

  it('shows a project only the watches that are not hidden, and lists the hidden ones and the shown ones', async () => {
    const { watches, made } = context()
    await watches.apply({ ABC: 'D:/abc', XYZ: 'D:/xyz' })
    made[1]!.hidden = true
    expect(watches.shown('ABC')).toEqual([made[0]])
    expect(watches.shown('XYZ')).toEqual([])
    expect(watches.places(true)).toEqual([{ project: 'XYZ', target: target('D:/xyz') }])
    expect(watches.places(false)).toEqual([{ project: 'ABC', target: target('D:/abc') }])
  })
})
