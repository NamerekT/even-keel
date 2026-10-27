import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('instruction file size', () => {
  it.each(['CLAUDE.md', 'tally/CLAUDE.md'])('%s stays within 13000 bytes', (path) => {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url)).length
    expect(bytes, `${path} is ${bytes} bytes, above the 13000-byte ceiling. Move architecture details, history, task IDs and measurements into the area's document or JSDoc. Keep principles and traps every task needs; do not compress prose into telegraph style or discard rules for space. Only the user may raise the ceiling.`).toBeLessThanOrEqual(13000)
  })
})
