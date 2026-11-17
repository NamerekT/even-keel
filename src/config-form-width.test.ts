import { describe, expect, it } from 'vitest'
import { formsOf, withProjectForm } from './config-form.js'
import { parseConfig } from './config.js'

const entry = { id: 'id-abc', key: 'ABC', tracker: 'builtin', repo: 'C:/example' }
const formOf = (raw: unknown) => formsOf(parseConfig(raw)).projects[entry.id]!

describe('saving the project width from the form', () => {
  it('writes a width above one and reads it back', () => {
    const raw = { projects: [entry] }
    const base = formOf(raw)
    expect(base.width).toBe(1)
    const next = withProjectForm(raw, entry.id, { ...base, width: 3 }, base)
    expect(next.projects).toEqual([{ ...entry, width: 3 }])
    expect(formOf(next).width).toBe(3)
  })

  it('drops the key when the width goes back to one', () => {
    const raw = { projects: [{ ...entry, width: 2 }] }
    const base = formOf(raw)
    expect(withProjectForm(raw, entry.id, { ...base, width: 1 }, base).projects).toEqual([entry])
  })

  it('keeps a width written elsewhere when the form left it as it was', () => {
    const raw = { projects: [entry] }
    const base = formOf(raw)
    const next = withProjectForm({ projects: [{ ...entry, width: 4 }] }, entry.id, { ...base, name: 'Example' }, base)
    expect(next.projects).toEqual([{ ...entry, width: 4, name: 'Example' }])
  })
})

describe('saving "Lanes by component" from the form (BTN-1273)', () => {
  it('is off by default, writes the switch on and drops the key once it is off again', () => {
    const raw = { projects: [entry] }
    const base = formOf(raw)
    expect(base.componentLanes).toBe(false)
    const next = withProjectForm(raw, entry.id, { ...base, componentLanes: true }, base)
    expect(next.projects).toEqual([{ ...entry, componentLanes: true }])
    expect(formOf(next).componentLanes).toBe(true)
    expect(withProjectForm(next, entry.id, { ...formOf(next), componentLanes: false }, formOf(next)).projects).toEqual([entry])
  })
})
