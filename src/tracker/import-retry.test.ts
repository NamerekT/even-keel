import { describe, expect, it } from 'vitest'
import type { ImportFile, ImportSource, ImportTask } from './import.js'
import { retryingSource, SourceBusy, sourceBusy } from './import-retry.js'
import { errorText } from './error-text.js'

const BUSY = 'sql: memory budget exceeded'

/** A source whose calls fail with `errors` in turn, then answer. */
function flaky(errors: Error[], extra: Partial<ImportSource> = {}): ImportSource & { calls: string[] } {
  const calls: string[] = []
  const answer = async <T>(name: string, value: T): Promise<T> => {
    calls.push(name)
    const error = errors.shift()
    if (error !== undefined) throw error
    return value
  }
  const file: ImportFile = { key: 'f1', name: 'a.png', type: '', size: 1, read: () => answer('read', new Uint8Array([1])) }
  return {
    calls,
    transient: (error) => error instanceof Error && error.message.includes(BUSY),
    tasks: () => answer('tasks', [{ ref: 't1' } as ImportTask]),
    milestones: () => answer('milestones', []),
    comments: (ref) => answer(`comments ${ref}`, []),
    files: async () => [file],
    changes: (ref) => answer(`changes ${ref}`, []),
    parallel: 3,
    timeReports: true,
    ...extra,
  }
}

const quick = { pauses: [0, 0, 0], say: () => {} }

describe('retryingSource', () => {
  it('asks again after a transient refusal and answers as the source does', async () => {
    const source = flaky([new Error(BUSY), new Error(BUSY)])
    const said: string[] = []
    const retrying = retryingSource(source, { ...quick, say: (line) => said.push(line) })
    expect(await retrying.tasks()).toEqual([{ ref: 't1' }])
    expect(source.calls).toEqual(['tasks', 'tasks', 'tasks'])
    expect(said).toHaveLength(2)
    expect(said[0]).toContain(BUSY)
  })

  it('becomes SourceBusy after the last pause, the reason under it', async () => {
    const source = flaky([1, 2, 3, 4].map(() => new Error(BUSY)))
    const failure = await retryingSource(source, quick).comments('t1').catch((error: unknown) => error)
    expect(source.calls).toHaveLength(4)
    expect(failure).toBeInstanceOf(SourceBusy)
    expect((failure as SourceBusy).tries).toBe(4)
    expect(errorText(failure)).toContain(BUSY)
  })

  it('passes a refusal the adapter does not call transient at once', async () => {
    const source = flaky([new Error('403 forbidden')])
    const failure = await retryingSource(source, quick).changes!('t1').catch((error: unknown) => error)
    expect(source.calls).toEqual(['changes t1'])
    expect(failure).not.toBeInstanceOf(SourceBusy)
  })

  it('asks nothing again where the adapter names no transient refusal', async () => {
    const source = flaky([new Error(BUSY)], { transient: undefined })
    await expect(retryingSource(source, quick).milestones()).rejects.toThrow(BUSY)
    expect(source.calls).toEqual(['milestones'])
  })

  it("asks a file's bytes again", async () => {
    const source = flaky([new Error(BUSY)])
    const [file] = await retryingSource(source, quick).files('t1')
    expect(await file!.read()).toEqual(new Uint8Array([1]))
    expect(source.calls).toEqual(['read', 'read'])
  })

  it("gives the name, type and size the source's file learns on its read", async () => {
    const learning: ImportFile = {
      key: 'f1', name: 'id', type: '', size: null,
      async read() {
        Object.assign(learning, { name: 'id.png', type: 'image/png', size: 1 })
        return new Uint8Array([1])
      },
    }
    const [file] = await retryingSource(flaky([], { files: async () => [learning] }), quick).files('t1')
    await file!.read()
    expect(file).toMatchObject({ name: 'id.png', type: 'image/png', size: 1 })
  })

  it('keeps what the source has and has not', () => {
    const retrying = retryingSource(flaky([], { changes: undefined, milestoneGaps: ['closedAt'] }), quick)
    expect(retrying.changes).toBeUndefined()
    expect(retrying.parallel).toBe(3)
    expect(retrying.timeReports).toBe(true)
    expect(retrying.milestoneGaps).toEqual(['closedAt'])
  })

  it('finds SourceBusy under the errors that wrap it', () => {
    const busy = new SourceBusy(4, new Error(BUSY))
    expect(sourceBusy(new Error('stop', { cause: busy }))).toBe(busy)
    expect(sourceBusy(new Error(BUSY))).toBeNull()
  })
})
