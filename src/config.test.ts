import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'

describe('parseConfig', () => {
  it('fills defaults when only projects are given', () => {
    const config = parseConfig({ projects: { ABC: 'C:\\repos\\abc' } })
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 4747,
      projects: { ABC: 'C:\\repos\\abc' },
      context: { window: 600_000, warn: 50, danger: 80 },
    })
  })

  it('keeps explicit host and port', () => {
    const config = parseConfig({ host: '127.0.0.1', port: 5000, projects: {} })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(5000)
  })

  it('rejects a port outside the TCP range', () => {
    expect(() => parseConfig({ port: 70000, projects: {} })).toThrow(/port/)
  })

  it('rejects a project key that is not a Huly identifier', () => {
    expect(() => parseConfig({ projects: { 'bad key': 'C:\\x' } })).toThrow(/bad key/)
  })

  it('rejects an empty repository path', () => {
    expect(() => parseConfig({ projects: { ABC: '' } })).toThrow(/ABC/)
  })

  it('rejects a missing projects map', () => {
    expect(() => parseConfig({})).toThrow(/projects/)
  })
  it('keeps an explicit context scale', () => {
    const config = parseConfig({ projects: {}, context: { window: 200_000, warn: 60, danger: 85 } })
    expect(config.context).toEqual({ window: 200_000, warn: 60, danger: 85 })
  })

  it('fills the missing parts of a context scale', () => {
    expect(parseConfig({ projects: {}, context: { window: 1_000_000 } }).context).toEqual({
      window: 1_000_000,
      warn: 50,
      danger: 80,
    })
  })

  it('rejects a context window that is not a positive integer', () => {
    expect(() => parseConfig({ projects: {}, context: { window: 0 } })).toThrow(/context.window/)
    expect(() => parseConfig({ projects: {}, context: { window: 1.5 } })).toThrow(/context.window/)
  })

  it('rejects context thresholds outside 0..100 or out of order', () => {
    expect(() => parseConfig({ projects: {}, context: { warn: 0 } })).toThrow(/context/)
    expect(() => parseConfig({ projects: {}, context: { danger: 120 } })).toThrow(/context/)
    expect(() => parseConfig({ projects: {}, context: { warn: 80, danger: 80 } })).toThrow(/context/)
  })

  it('rejects a context scale that is not an object', () => {
    expect(() => parseConfig({ projects: {}, context: 600_000 })).toThrow(/context/)
  })
})
