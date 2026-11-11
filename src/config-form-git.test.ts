import { describe, expect, it } from 'vitest'
import { formsOf, withProjectForm } from './config-form.js'
import { parseConfig } from './config.js'

const entry = { id: 'id-abc', key: 'ABC', tracker: 'builtin', repo: 'C:/example' }
const formOf = (raw: unknown) => formsOf(parseConfig(raw)).projects[entry.id]!

describe('saving the git mode', () => {
  it.each([0, 2])('turns git on and replaces a hidden slot count with %i', (slot) => {
    const raw = { projects: [{ ...entry, git: false, slot: 3 }] }
    const base = formOf(raw)
    const next = withProjectForm(raw, entry.id, { ...base, git: true, slot }, { ...base, slot: -1 })
    expect(next.projects).toEqual([{ ...entry, ...(slot === 0 ? {} : { slot }) }])
    expect(formOf(next)).toMatchObject({ git: true, slot })
  })

  it('turns git off, keeps the hidden settings and reads the mode back', () => {
    const raw = { projects: [{ ...entry, slot: 2, pullRequests: true }] }
    const base = formOf(raw)
    const next = withProjectForm(raw, entry.id, { ...base, git: false }, base)
    expect(next.projects).toEqual([{ ...entry, slot: 2, pullRequests: true, git: false }])
    expect(formOf(next)).toMatchObject({ git: false, slot: 0, pullRequests: false })
  })

  it('leaves a later git edit alone when an old settings form changes another field', () => {
    const raw = { projects: [entry] }
    const base = formOf(raw)
    const next = withProjectForm({ projects: [{ ...entry, git: false }] }, entry.id, { ...base, name: 'Example' }, base)
    expect(next.projects).toEqual([{ ...entry, git: false, name: 'Example' }])
  })
})
