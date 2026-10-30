import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

describe('OpenCode Protection migration', () => {
  it('preserves v15 overrides and lets omitted OpenCode patterns inherit the empty default', () => {
    const raw = { version: 15, protection: { disabled: ['mirrorPush'], claude: ['Write(.env)'] }, projects: [{ id: 'p', key: 'ABC', tracker: 'huly', repo: 'C:/example', protection: { disabled: ['forcePush'] } }] }
    const migrated = currentConfig(raw)
    expect(migrated).toEqual({ ...raw, version: SCHEMA_VERSION })
    expect(currentConfig(migrated)).toEqual(migrated)
    const config = parseConfig(migrated)
    expect(config.protection.opencode).toEqual([])
    expect(config.settings.p?.protection).toMatchObject({ disabled: ['forcePush'], claude: ['Write(.env)'], opencode: [] })
  })
})
