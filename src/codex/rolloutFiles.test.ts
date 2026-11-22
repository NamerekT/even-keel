import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rolloutFile, rolloutFiles } from './rolloutFiles.js'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let home: string

async function rollout(day: string, n: number): Promise<string> {
  const dir = join(home, 'sessions', ...day.split('/'))
  await mkdir(dir, { recursive: true })
  const file = join(dir, `rollout-2026-11-22T00-00-0${n % 10}-${id(n)}.jsonl`)
  await writeFile(file, '')
  return file
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ek-rollouts-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('rolloutFiles', () => {
  it('lists the rollouts newest first across years, months and days, skipping other files', async () => {
    const old = await rollout('2025/12/31', 1)
    const mid = await rollout('2026/11/02', 2)
    const late = await rollout('2026/11/21', 3)
    const later = await rollout('2026/11/21', 4)
    await writeFile(join(home, 'sessions', '2026', '11', '21', 'notes.txt'), '')
    expect(await rolloutFiles(home)).toEqual([
      { id: id(4), file: later },
      { id: id(3), file: late },
      { id: id(2), file: mid },
      { id: id(1), file: old },
    ])
  })

  it('stops at the limit with the newest ones', async () => {
    await rollout('2025/12/31', 1)
    const mid = await rollout('2026/11/02', 2)
    const late = await rollout('2026/11/21', 3)
    expect(await rolloutFiles(home, 2)).toEqual([
      { id: id(3), file: late },
      { id: id(2), file: mid },
    ])
  })

  it('gives nothing for a folder without sessions', async () => {
    expect(await rolloutFiles(home)).toEqual([])
  })
})

describe('rolloutFile', () => {
  it('finds a rollout written after a miss', async () => {
    await rollout('2026/11/20', 1)
    expect(await rolloutFile(home, id(2))).toBeUndefined()
    const file = await rollout('2026/11/22', 2)
    expect(await rolloutFile(home, id(2))).toBe(file)
  })

  it('does not give a rollout deleted after it was found', async () => {
    const file = await rollout('2026/11/20', 1)
    expect(await rolloutFile(home, id(1))).toBe(file)
    await rm(file)
    expect(await rolloutFile(home, id(1))).toBeUndefined()
  })

  it('keeps a found path without walking the folder again', async () => {
    const file = await rollout('2026/11/20', 1)
    expect(await rolloutFile(home, id(1))).toBe(file)
    // A walk would meet this newer file of the same id first; the cache answers without one.
    await rollout('2026/11/21', 1)
    expect(await rolloutFile(home, id(1))).toBe(file)
  })

  it('remembers the rollouts a limited listing passed', async () => {
    const file = await rollout('2026/11/20', 1)
    await rolloutFiles(home, 1)
    await rollout('2026/11/21', 1)
    expect(await rolloutFile(home, id(1))).toBe(file)
  })
})
