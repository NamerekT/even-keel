import { describe, expect, it } from 'vitest'
import { ceilingOf, oversized } from './docs-size.ts'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

describe('the size of a documentation page', () => {
  it('holds every guide page and every area document under its ceiling', () => {
    expect(
      oversized(root),
      'Cut the page by subtopic instead of squeezing it: a short index with a row per subtopic and a file each (docs/chain.md and docs/chain/ are the pattern). The guide describes what a person does; how it is built goes into docs/<area>.md.',
    ).toEqual([])
  })

  it('is red on a page above its ceiling', () => {
    const sizes = new Map([['docs/guide/setup.md', 30_001], ['docs/trackers.md', 40_001], ['docs/web/fake-states.md', 40_000]])
    expect(oversized(root, sizes)).toEqual(['docs/guide/setup.md (30001 bytes, ceiling 30000)', 'docs/trackers.md (40001 bytes, ceiling 40000)'])
  })

  it('leaves the journals and posts out', () => {
    for (const path of ['docs/verified/chain.md', 'docs/unverified/ci.md', 'docs/verified.md', 'docs/unverified.md', 'docs/posts/x.md']) expect(ceilingOf(path)).toBeNull()
  })
})
