import { describe, expect, it } from 'vitest'
import { formsOf, withNewProject, withProjectForm } from '../config-form.js'
import { parseConfig } from '../config.js'
import { currentConfig } from '../storage/migrations.js'
import { SCHEMA_VERSION } from '../storage/schema.js'
import { draftOfFields, EMPTY_FIELDS } from '../../web/src/pages/projectWizard.js'

const raw = { version: 24, projects: [{ id: 'p', key: 'ABC', repo: 'D:/repo', tracker: 'huly' }] }

describe('project trust consent', () => {
  it('keeps old projects opted out after migration and form round trips', () => {
    const migrated = currentConfig(raw)
    expect(migrated).toEqual({ ...raw, version: SCHEMA_VERSION })
    const form = formsOf(parseConfig(migrated)).projects.p!
    expect(form.trustClaude).toBe(false)
    const enabled = withProjectForm(migrated, 'p', { ...form, trustClaude: true }, form)
    expect(formsOf(parseConfig(enabled)).projects.p!.trustClaude).toBe(true)
    expect((enabled.projects as object[])[0]).toMatchObject({ trustClaude: true })
  })

  it('persists the wizard default and its explicit opt out', () => {
    for (const trustClaude of [true, false]) {
      const draft = draftOfFields({ ...EMPTY_FIELDS, key: 'NEW', repo: 'D:/new', tracker: 'huly', trustClaude })!
      const added = withNewProject({ projects: [] }, draft, 'new')
      expect(formsOf(parseConfig(added)).projects.new!.trustClaude).toBe(trustClaude)
    }
  })

  it('validates consent and never inherits a shared setting', () => {
    expect(parseConfig({ ...raw, trustClaude: true }).settings.p!.trustClaude).not.toBe(true)
    expect(() => parseConfig({ projects: [{ ...raw.projects[0], trustClaude: 'true' }] })).toThrow()
  })
})
