import { describe, expect, it } from 'vitest'
import { readTaskActive, type StepsDb } from './steps-reader.js'

const dbOf = (rows: Record<string, unknown>[]): StepsDb & { asked: unknown[][] } => {
  const asked: unknown[][] = []
  return {
    asked,
    base: async () => [],
    plain: async (_sql, params) => {
      asked.push(params)
      return rows
    },
  }
}

describe('readTaskActive', () => {
  it("gives the task's active seconds from Tally's task times", async () => {
    const db = dbOf([{ task: 'ABC-1', active_s: '2040' }])
    expect(await readTaskActive(db, 'ABC-1')).toBe(2040)
    expect(db.asked).toEqual([[['ABC-1']]])
  })

  it('gives null for a task without a session', async () => {
    expect(await readTaskActive(dbOf([]), 'ABC-2')).toBeNull()
  })
})
