import { describe, expect, it } from 'vitest'
import { ONLY_VARIABLE, selectStands, SKIP_VARIABLE, type Stand } from './stands.fixture.js'

const stand = (name: string, tracker: string): Stand => ({ name, tracker, values: {}, place: { key: name.toUpperCase() } })
const stands = [stand('huly', 'huly'), stand('github', 'github'), stand('gitlab-com', 'gitlab'), stand('gitlab-ce', 'gitlab')]
const names = (list: readonly Stand[]): string[] => list.map((entry) => entry.name)

describe('selectStands', () => {
  it('runs every stand when neither variable is set', () => {
    const selection = selectStands(stands, {})
    expect(names(selection.run)).toEqual(['huly', 'github', 'gitlab-com', 'gitlab-ce'])
    expect(selection.skipped).toEqual([])
  })

  it('passes over the stands the night skips, by name or tracker, each with its reason', () => {
    const selection = selectStands(stands, { [SKIP_VARIABLE]: 'huly, gitlab' })
    expect(names(selection.run)).toEqual(['github'])
    expect(selection.skipped.map((skip) => skip.stand.name)).toEqual(['huly', 'gitlab-com', 'gitlab-ce'])
    expect(selection.skipped[0]!.reason).toContain(SKIP_VARIABLE)
  })

  it('runs only the stands named for a run on demand', () => {
    const selection = selectStands(stands, { [ONLY_VARIABLE]: 'huly' })
    expect(names(selection.run)).toEqual(['huly'])
    expect(selection.skipped.map((skip) => skip.stand.name)).toEqual(['github', 'gitlab-com', 'gitlab-ce'])
    expect(selection.skipped[0]!.reason).toContain(ONLY_VARIABLE)
  })

  it('refuses a run on demand that names no stand: it would check nothing and pass', () => {
    expect(() => selectStands([stand('github', 'github')], { [ONLY_VARIABLE]: 'huly' })).toThrow(/huly/)
  })

  it('takes a skipped name the stands lack as nothing to skip', () => {
    expect(names(selectStands([stand('github', 'github')], { [SKIP_VARIABLE]: 'huly' }).run)).toEqual(['github'])
  })
})
