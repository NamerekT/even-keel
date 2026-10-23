import { describe, expect, it } from 'vitest'
import type { TrackerVocabulary } from './source.js'
import { Vocabularies } from './vocabulary.js'

const VOCABULARY: TrackerVocabulary = { statuses: [{ name: 'Open', category: 'ToDo' }], labels: ['bug'] }

function setup(answers: (TrackerVocabulary | undefined | Error)[]) {
  let now = 0
  const reads: string[] = []
  const cache = new Vocabularies(
    async (project) => {
      reads.push(project)
      const answer = answers.shift()
      if (answer instanceof Error) throw answer
      return answer
    },
    () => now,
    1_000,
  )
  return { cache, reads, pass: (ms: number) => (now += ms) }
}

describe('Vocabularies', () => {
  it('reads a project once while the answer is fresh, and again once it is not', async () => {
    const { cache, reads, pass } = setup([VOCABULARY, { ...VOCABULARY, labels: ['ui'] }])
    expect(await cache.get('ABC')).toEqual(VOCABULARY)
    pass(999)
    expect(await cache.get('ABC')).toEqual(VOCABULARY)
    pass(1)
    expect(await cache.get('ABC')).toEqual({ ...VOCABULARY, labels: ['ui'] })
    expect(reads).toEqual(['ABC', 'ABC'])
  })

  it('shares one read between the calls that come while it runs', async () => {
    const { cache, reads } = setup([VOCABULARY])
    expect(await Promise.all([cache.get('ABC'), cache.get('ABC')])).toEqual([VOCABULARY, VOCABULARY])
    expect(reads).toEqual(['ABC'])
  })

  it('keeps projects apart', async () => {
    const { cache, reads } = setup([VOCABULARY, undefined])
    await cache.get('ABC')
    expect(await cache.get('XYZ')).toBeUndefined()
    expect(reads).toEqual(['ABC', 'XYZ'])
  })

  it('does not keep a failure or a missing answer', async () => {
    const { cache, reads } = setup([new Error('down'), undefined, VOCABULARY])
    await expect(cache.get('ABC')).rejects.toThrow('down')
    expect(await cache.get('ABC')).toBeUndefined()
    expect(await cache.get('ABC')).toEqual(VOCABULARY)
    expect(reads).toEqual(['ABC', 'ABC', 'ABC'])
  })
})
