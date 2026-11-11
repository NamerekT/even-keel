import { describe, expect, it } from 'vitest'
import { BUILTIN } from '../../../src/builtin/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { firstFields, keepFields } from './projectWizardDraft.js'
import { suggestOfRepo, switchBuiltin, switchProfile, typedIn } from './projectWizard.js'

function state(defaultGit: boolean | null, profiles: { id: string; kind: string }[] = []): EvenKeelState {
  return {
    config: { shared: { defaultGit } },
    git: { version: '2.47.1' },
    profiles: { kinds: [{ kind: 'huly', tracker: true }, { kind: 'github', tracker: true }, { kind: 'forgejo', tracker: false }], profiles },
  } as unknown as EvenKeelState
}

describe('the project wizard draft', () => {
  it('refreshes untouched git and tracker defaults after editing an unrelated field', () => {
    const before = firstFields(state(true))
    const kept = keepFields({}, before, typedIn(before, 'name', 'Shop'))
    expect(kept).not.toHaveProperty('git')
    expect(kept).not.toHaveProperty('tracker')
    expect(firstFields(state(false, [{ id: 'huly-1', kind: 'huly' }]), kept)).toMatchObject({
      git: false, name: 'Shop', tracker: 'huly', profile: 'huly-1',
    })
  })

  it('keeps manual git choices even after returning to the old default', () => {
    const before = firstFields(state(true))
    const off = { ...before, git: false }
    const kept = keepFields(keepFields({}, before, off), off, before)
    expect(firstFields(state(false), kept).git).toBe(true)
  })

  it('keeps a suggested name that the person types unchanged', () => {
    const before = suggestOfRepo(firstFields(state(true)), 'place', { root: 'D:/Projects/shop', current: 'dev', suggested: 'org/shop' })
    const kept = keepFields({}, before, typedIn(before, 'name', before.name))
    expect(firstFields(state(false), kept)).toMatchObject({ name: 'shop', typed: { name: true } })
  })

  it('keeps the profile and its tracker together when only the profile id changes', () => {
    const before = firstFields(state(true, [{ id: 'huly-1', kind: 'huly' }]))
    const kept = keepFields({}, before, switchProfile(before, { id: 'huly-2', kind: 'huly' }))
    expect(firstFields(state(true, [{ id: 'github-1', kind: 'github' }]), kept)).toMatchObject({ tracker: 'huly', profile: 'huly-2' })
  })

  it('keeps an explicit built-in choice when a profile becomes available', () => {
    const before = firstFields(state(true, [{ id: 'huly-1', kind: 'huly' }]))
    const kept = keepFields({}, before, switchBuiltin(before))
    expect(firstFields(state(true, [{ id: 'huly-1', kind: 'huly' }]), kept)).toMatchObject({ tracker: BUILTIN, profile: '' })
  })

  it('does not freeze an automatic profile when its project is typed', () => {
    const before = firstFields(state(true))
    const kept = keepFields({}, before, typedIn(before, 'key', 'SHOP'))
    expect(firstFields(state(true, [{ id: 'huly-1', kind: 'huly' }]), kept)).toMatchObject({ tracker: 'huly', profile: 'huly-1', key: 'SHOP' })
  })

  it('uses built-in with no tracker profiles, asks with several, and ignores CI-only profiles', () => {
    expect(firstFields(state(true, [{ id: 'ci', kind: 'forgejo' }])).tracker).toBe(BUILTIN)
    expect(firstFields(state(true, [{ id: 'a', kind: 'huly' }, { id: 'b', kind: 'github' }]))).toMatchObject({ tracker: '', profile: '' })
  })

  it('uses git availability before setup has an answer', () => {
    const available = state(null)
    expect(firstFields(available).git).toBe(true)
    expect(firstFields({ ...available, git: { version: null, name: null, email: null } }).git).toBe(false)
    expect(firstFields({ ...state(true), git: { version: null, name: null, email: null } }).git).toBe(true)
  })
})
