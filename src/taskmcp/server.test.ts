import { describe, expect, it } from 'vitest'
import { ADAPTERS } from '../tracker/adapters.js'
import { servesTasks } from './server.js'

describe('servesTasks', () => {
  it('serves the tracker whose own server is the tasks server', () => {
    expect(servesTasks(ADAPTERS.builtin)).toBe(true)
  })

  it('serves a tracker whose source edits tasks', () => {
    expect(servesTasks(ADAPTERS.huly)).toBe(true)
  })

  it('does not serve a tracker without an editor', () => {
    expect(servesTasks(ADAPTERS.github)).toBe(false)
    expect(servesTasks(ADAPTERS.linear)).toBe(false)
  })

  it('does not serve an unknown tracker', () => {
    expect(servesTasks(undefined)).toBe(false)
  })
})
