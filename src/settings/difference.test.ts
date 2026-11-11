import { describe, expect, it } from 'vitest'
import { configDifference, difference } from './difference.fixture.js'
import { configDefaults } from './expectations.fixture.js'

describe('config snapshot differences', () => {
  it('keeps a new default out of every snapshot while detecting a wrong value', () => {
    const config = configDefaults({ ABC: 'C:\\abc' })
    const baseline = { ...config, futureSetting: true }
    expect(difference({ ...config, futureSetting: true }, baseline)).toEqual({ changed: {}, missing: [] })
    expect(difference({ ...config, futureSetting: false }, baseline)).toEqual({ changed: { '/futureSetting': false }, missing: [] })
    expect(difference(config, baseline)).toEqual({ changed: {}, missing: ['/futureSetting'] })
    expect(difference({ ...config, futureSetting: undefined }, baseline)).toEqual({ changed: {}, missing: ['/futureSetting'] })
  })

  it('distinguishes missing fields, null and empty lists, including inside a project', () => {
    const config = configDefaults({ ABC: 'C:\\abc' })
    const { cacheTtl, ...settings } = config.settings.ABC!
    const actual = { ...config, settings: { ABC: { ...settings, beforeStart: null, prompt: [] } } }
    expect(difference(actual, config)).toEqual({
      changed: { '/settings/ABC/beforeStart': null, '/settings/ABC/prompt': [] },
      missing: ['/settings/ABC/cacheTtl'],
    })
  })

  it('keeps non-default fields and escapes map keys', () => {
    expect(difference({ 'a/b~c': { 'ci.guard': false }, added: [] }, { 'a/b~c': { 'ci.guard': true } })).toEqual({
      changed: { '/a~1b~0c/ci.guard': false, '/added': [] }, missing: [],
    })
  })

  it('retains project identities and repositories in the snapshots', () => {
    const config = configDefaults({ ABC: 'C:\\abc' })
    expect(configDifference(config).changed).toMatchObject({ '/projects/ABC': 'C:\\abc', '/keys/ABC': 'ABC' })
    expect(configDifference({ ...config, projects: { ABC: 'D:\\other' } })).not.toEqual(configDifference(config))
  })
})
