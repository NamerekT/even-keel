import { describe, expect, it } from 'vitest'
import { formsOf, withNewProject, withProjectForm } from '../config-form.js'
import { parseConfig } from '../config.js'
import { currentConfig } from '../storage/migrations.js'
import { SCHEMA_VERSION } from '../storage/schema.js'
import { draftOfFields, EMPTY_FIELDS } from '../../web/src/pages/projectWizard.js'

const project = { id: 'p', key: 'ABC', repo: 'D:/repo', tracker: 'huly' }

describe('automatic Claude trust configuration', () => {
  it.each([true, false, undefined])('removes legacy consent %s without changing other project data', (trustClaude) => {
    const raw = { version: 25, projects: [{ ...project, trustClaude }], language: 'ru' }
    const migrated = currentConfig(raw)
    expect(migrated).toEqual({ version: SCHEMA_VERSION, chain: { excludedLabels: ['Manual', 'Вручную'] }, projects: [project], language: 'ru' })
    expect(currentConfig(migrated)).toEqual(migrated)
    const form = formsOf(parseConfig(migrated)).projects.p!
    expect(form).not.toHaveProperty('trustClaude')
    const saved = withProjectForm(migrated, 'p', form, form)
    expect((saved.projects as object[])[0]).not.toHaveProperty('trustClaude')
    expect(raw.projects[0]).toHaveProperty('trustClaude', trustClaude)
  })

  it('does not add a trust switch through the wizard or forms', () => {
    const draft = draftOfFields({ ...EMPTY_FIELDS, source: 'existing', key: 'NEW', repo: 'D:/new', tracker: 'huly' })!
    expect(draft).not.toHaveProperty('trustClaude')
    const added = withNewProject({ projects: [] }, draft, 'new')
    expect((added.projects as object[])[0]).not.toHaveProperty('trustClaude')
    expect(formsOf(parseConfig(added)).projects.new!).not.toHaveProperty('trustClaude')
  })
})
