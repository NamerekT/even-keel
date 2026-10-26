import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { formsOf, withSharedForm, withProjectForm } from '../config-form.js'

const raw = { projects: [{ id: 'p', key: 'ABC', repo: 'C:/example', tracker: 'huly' }] }
describe('Protection settings', () => {
  it('inherits individual fields and keeps a project override when the shared value changes', () => {
    const config = parseConfig({ ...raw, protection: { claude: ['Write(.env)'] }, projects: [{ ...raw.projects[0], protection: { disabled: ['deleteTracker'] } }] })
    expect(config.settings.p?.protection).toEqual({ disabled: ['deleteTracker'], claude: ['Write(.env)'], codex: [], copilot: [] })
  })

  it('rejects unknown groups and malformed native command prefixes', () => {
    for (const protection of [{ disabled: ['unknown'] }, { codex: [[]] }, { codex: ['git'] }, { claude: [3] }, { typo: [] }]) {
      expect(() => parseConfig({ ...raw, protection })).toThrow()
    }
  })

  it('round trips global and project edits through the forms', () => {
    const config = parseConfig(raw)
    const forms = formsOf(config)
    const protection = { disabled: ['forcePush'], claude: [], codex: [['terraform', 'destroy']], copilot: [] }
    const shared = withSharedForm(raw, { ...forms.shared, protection }, forms.shared)
    expect(parseConfig(shared).protection).toEqual(protection)
    const form = forms.projects.p!
    const project = withProjectForm(raw, 'p', { ...form, own: { ...form.own, protection } }, form)
    expect(parseConfig(project).settings.p?.protection).toEqual(protection)
  })
})
