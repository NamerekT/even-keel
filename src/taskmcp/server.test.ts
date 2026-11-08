import { describe, expect, it } from 'vitest'
import { ADAPTERS } from '../tracker/adapters.js'
import { servesTasks } from './server.js'

describe('servesTasks', () => {
  it('serves the tracker whose own server is the tasks server', () => {
    expect(servesTasks(ADAPTERS.builtin)).toBe(true)
  })

  it('serves every tracker whose source edits tasks', () => {
    for (const name of ['huly', 'github', 'linear', 'jira', 'gitlab', 'forgejo'] as const) expect(servesTasks(ADAPTERS[name]), name).toBe(true)
  })

  it('does not serve a tracker without an editor', () => {
    const { editsTasks, ...plain } = ADAPTERS.github
    expect(editsTasks).toBe(true)
    expect(servesTasks(plain)).toBe(false)
  })

  it('does not serve an unknown tracker', () => {
    expect(servesTasks(undefined)).toBe(false)
  })
})
