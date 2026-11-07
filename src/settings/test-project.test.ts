import { describe, expect, it } from 'vitest'
import { formsOf, withProjectForm } from '../config-form.js'
import { parseConfig } from '../config.js'

const project = { id: 'project-a', key: 'ABC', repo: 'C:/example', tracker: 'builtin' }

describe('test projects', () => {
  it('defaults to ordinary and round-trips the live project form', () => {
    const raw = { projects: [project] }
    const base = formsOf(parseConfig(raw)).projects[project.id]!
    expect(base.testProject).toBe(false)
    const saved = withProjectForm(raw, project.id, { ...base, testProject: true }, base)
    const form = formsOf(parseConfig(saved)).projects[project.id]!
    expect(form.testProject).toBe(true)
    expect(formsOf(parseConfig(withProjectForm(saved, project.id, { ...form, testProject: false }, form))).projects[project.id]!.testProject).toBe(false)
  })

  it('refuses non-boolean values and does not inherit a global flag', () => {
    expect(() => parseConfig({ projects: [{ ...project, testProject: 'yes' }] })).toThrow()
    expect(formsOf(parseConfig({ testProject: true, projects: [project] })).projects[project.id]!.testProject).toBe(false)
  })
})
