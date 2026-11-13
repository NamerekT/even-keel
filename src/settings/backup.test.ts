import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { SCHEMA_VERSION } from '../storage/schema.js'

const parsed = (backup: unknown) => parseConfig({ version: SCHEMA_VERSION, projects: [], backup }).backup

describe('the backup settings', () => {
  it('default to the state folder and fourteen copies', () => {
    expect(parseConfig({ version: SCHEMA_VERSION, projects: [] }).backup).toEqual({ dir: null, keep: 14 })
  })

  it.each(['D:\\copies', 'd:/copies', '\\\\nas\\copies', '/var/copies'])('take the absolute folder %s', (dir) => {
    expect(parsed({ dir: ` ${dir} ` }).dir).toBe(dir)
  })

  it('take an empty folder for the default', () => {
    expect(parsed({ dir: '  ' }).dir).toBeNull()
  })

  it.each(['copies', './copies', 3])('refuse the folder %s', (dir) => {
    expect(() => parsed({ dir })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.backupDir' }) }))
  })

  it.each([0, 366, 2.5, '7'])('refuse %s copies', (keep) => {
    expect(() => parsed({ keep })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.backupKeep' }) }))
  })
})
