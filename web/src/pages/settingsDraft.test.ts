import { describe, expect, it } from 'vitest'
import { changed, conflicts, edited, inheritedEdit, ownEdited, rebase, reverted, sent, settled, type Value } from './settingsDraft.js'

// Text compares trimmed, as the service stores it; lists regardless of order.
const canon = (value: Value) => (typeof value === 'string' ? value.trim() : Array.isArray(value) ? [...value].sort() : value)
const same = (_key: string, a: Value, b: Value) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const saved = { repo: 'C:/abc', branch: 'main', brief: true }

describe('a settings draft', () => {
  it('starts from the file and counts a field changed until its value is back to the character', () => {
    const fresh = rebase(undefined, saved, same)
    expect(fresh).toEqual({ base: saved, edit: saved })
    const typed = edited(fresh, 'branch', 'dev')
    expect(changed(typed, ['repo', 'branch'], same)).toEqual(['branch'])
    expect(changed(edited(typed, 'branch', 'main '), ['branch'], same)).toEqual([])
  })

  it('keeps what is typed while the file stays as it was, stray spaces too', () => {
    const typed = edited(rebase(undefined, saved, same), 'repo', 'C:/abc ')
    expect(rebase(typed, saved, same).edit.repo).toBe('C:/abc ')
  })

  it('takes the file into fields nobody edited and keeps the edits', () => {
    const typed = edited(rebase(undefined, saved, same), 'branch', 'dev')
    const next = rebase(typed, { ...saved, repo: 'D:/abc' }, same)
    expect(next).toEqual({ base: { ...saved, repo: 'D:/abc' }, edit: { ...saved, repo: 'D:/abc', branch: 'dev' } })
    expect(conflicts(next, { ...saved, repo: 'D:/abc' }, ['repo', 'branch'], same)).toEqual([])
  })

  it('marks a field changed both in the draft and in the file, and drops the mark once they agree', () => {
    const typed = edited(rebase(undefined, saved, same), 'branch', 'dev')
    const file = { ...saved, branch: 'trunk' }
    const next = rebase(typed, file, same)
    expect(next.edit.branch).toBe('dev')
    expect(next.base.branch).toBe('main')
    expect(conflicts(next, file, ['repo', 'branch'], same)).toEqual(['branch'])
    expect(rebase(next, file, same)).toEqual(next)

    const agreed = rebase(edited(next, 'branch', 'trunk'), file, same)
    expect(changed(agreed, ['branch'], same)).toEqual([])
    expect(agreed.base.branch).toBe('trunk')
  })

  it('reverts the given fields to the file and leaves the others', () => {
    const typed = edited(edited(rebase(undefined, saved, same), 'branch', 'dev'), 'brief', false)
    const file = { ...saved, branch: 'trunk' }
    const back = reverted(rebase(typed, file, same), file, ['branch'])
    expect(back.edit).toEqual({ ...file, brief: false })
    expect(changed(back, ['repo', 'branch', 'brief'], same)).toEqual(['brief'])
  })

  it('keeps a saved field saved when the file later changes it again (BTN-598)', () => {
    const typed = edited(rebase(undefined, saved, same), 'branch', 'dev')
    const file = { ...saved, branch: 'dev' }
    const kept = settled(typed, file, same)!
    expect(kept).toEqual({ base: file, edit: file })
    expect(settled(kept, file, same)).toBeUndefined()

    const back = rebase(kept, saved, same)
    expect(back).toEqual({ base: saved, edit: saved })
    expect(changed(back, ['branch'], same)).toEqual([])
  })

  it('keeps nothing new while the file stays as the draft saw it', () => {
    expect(settled(undefined, saved, same)).toBeUndefined()
    const typed = edited(rebase(undefined, saved, same), 'branch', 'dev')
    expect(settled(typed, { ...saved }, same)).toBeUndefined()
  })

  describe('a field whose empty value is "as shared"', () => {
    const file = { guard: '', recheck: 'false' }

    it('inherits again when set back to the shared value it started with', () => {
      const off = inheritedEdit(rebase(undefined, file, same), 'guard', 'false', 'true', same)
      expect(off.edit.guard).toBe('false')
      const back = inheritedEdit(off, 'guard', 'true', 'true', same)
      expect(back.edit.guard).toBe('')
      expect(changed(back, ['guard'], same)).toEqual([])
    })

    it('keeps its own value when it started own, even one equal to the shared', () => {
      const on = inheritedEdit(rebase(undefined, file, same), 'recheck', 'true', 'true', same)
      expect(on.edit.recheck).toBe('true')
      expect(inheritedEdit(on, 'recheck', 'false', 'true', same).edit.recheck).toBe('false')
    })

    it('turns own with any other value, and a pick, as the provider, works the same way', () => {
      const fresh = rebase(undefined, { provider: '' }, same)
      expect(inheritedEdit(fresh, 'provider', 'claude', 'codex', same).edit.provider).toBe('claude')
      expect(inheritedEdit(fresh, 'provider', 'codex', 'codex', same).edit.provider).toBe('')
    })
  })

  describe('fields kept own by a flag', () => {
    const file = { ownWait: false, wait: '', ownKinds: true, kinds: ['forgejo'] }

    it('turn own on the first edit, starting from the shared values', () => {
      const typed = ownEdited(rebase(undefined, file, same), 'ownWait', { wait: '30' }, 'wait', '3', same)
      expect(typed.edit).toMatchObject({ ownWait: true, wait: '3' })
    })

    it('inherit again, as they started, once edited back to the shared values', () => {
      const typed = ownEdited(rebase(undefined, file, same), 'ownWait', { wait: '30' }, 'wait', '3', same)
      const back = ownEdited(typed, 'ownWait', { wait: '30' }, 'wait', '30', same)
      expect(back.edit).toMatchObject({ ownWait: false, wait: '' })
      expect(changed(back, ['ownWait', 'wait'], same)).toEqual([])
    })

    it('stay own when they started own', () => {
      const back = ownEdited(rebase(undefined, file, same), 'ownKinds', { kinds: ['github'] }, 'kinds', ['github'], same)
      expect(back.edit).toMatchObject({ ownKinds: true, kinds: ['github'] })
    })
  })

  it('sends the base with the edits of the given fields only', () => {
    const typed = edited(edited(rebase(undefined, saved, same), 'branch', 'dev'), 'brief', false)
    expect(sent(typed, ['branch'])).toEqual({ form: { ...saved, branch: 'dev' }, base: saved })
  })
})
