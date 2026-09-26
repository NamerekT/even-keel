import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'

describe('parseConfig', () => {
  it('fills defaults when only projects are given', () => {
    const config = parseConfig({ projects: { ABC: 'C:\\repos\\abc' } })
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 4747,
      projects: { ABC: 'C:\\repos\\abc' },
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
})
