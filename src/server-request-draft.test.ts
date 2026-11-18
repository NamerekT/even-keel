import { describe, expect, it } from 'vitest'
import { draftOf } from './server-request.js'

const BASE = { repo: '', branch: 'main', key: 'ABC', name: 'Example', tracker: 'builtin', trackerProject: '', profile: null, slot: 0, target: 'https://forge.example.com/team/abc.git' }

describe("the wizard's machines in a project draft (BTN-1297)", () => {
  it('reads each machine with its folder, and an unticked hub', () => {
    const draft = draftOf({ ...BASE, machines: [{ machine: 'm1', folder: '/home/example/projects/abc' }, { machine: 'm2' }], here: false })
    expect(draft.machines).toEqual([{ machine: 'm1', folder: '/home/example/projects/abc' }, { machine: 'm2' }])
    expect(draft.here).toBe(false)
  })

  it('reads none from a page that sends none, and refuses a malformed list', () => {
    const draft = draftOf(BASE)
    expect(draft.machines).toBeUndefined()
    expect(draft.here).toBeUndefined()
    expect(() => draftOf({ ...BASE, machines: 'm1' })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ params: { field: 'machines' } }) }))
    expect(() => draftOf({ ...BASE, machines: [{ folder: '/x' }] })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ params: { field: 'machine' } }) }))
  })
})
