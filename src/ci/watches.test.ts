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
