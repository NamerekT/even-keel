import { describe, expect, it } from 'vitest'
import { changed, conflicts, edited, rebase, reverted, sent, settled, type Value } from './settingsDraft.js'

// Text compares trimmed, as the service stores it.
const same = (_key: string, a: Value, b: Value) => JSON.stringify(typeof a === 'string' ? a.trim() : a) === JSON.stringify(typeof b === 'string' ? b.trim() : b)
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

  it('sends the base with the edits of the given fields only', () => {
    const typed = edited(edited(rebase(undefined, saved, same), 'branch', 'dev'), 'brief', false)
    expect(sent(typed, ['branch'])).toEqual({ form: { ...saved, branch: 'dev' }, base: saved })
  })
})
