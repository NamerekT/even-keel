import { describe, expect, it } from 'vitest'
import { asNotice, englishOf, fail, notice, noticeOf, renderNotice, sameNotice, textNotice, type NoticeTexts } from './notice.js'
import { en } from './en.js'

describe('notices', () => {
  it('renders the English text from the code and its values', () => {
    expect(englishOf(notice('chain.midTurn', { task: 'ABC-1' }))).toBe('chain: ABC-1 is mid-turn; wait until its session stops')
  })

  it('puts a one-line detail after a colon and a multi-line one on its own lines', () => {
    expect(englishOf(notice('sync.fetch', { remote: 'origin' }, { detail: 'fatal: no route\n' }))).toBe('sync: could not fetch origin: fatal: no route')
    expect(englishOf(notice('slot.dirty', { path: '/s' }, { detail: ' M a.ts\n?? b.ts' }))).toBe(
      'the slot /s has uncommitted changes; commit or remove them:\n M a.ts\n?? b.ts',
    )
  })

  it('renders a cause after the text and items on lines of their own', () => {
    const cause = notice('claude.stopFailed', { agent: 'a1' }, { detail: 'denied' })
    expect(englishOf(notice('cleanup.sessionNotStopped', { session: 's1' }, { cause }))).toBe(
      'its session s1 was not stopped: claude: could not stop a1: denied',
    )
    const items = [notice('slot.dirty', { path: '/a' }), notice('slot.busy', { path: '/b', sessions: ['X-1', 'X-2'] })]
    expect(englishOf(notice('slot.noneFree', { task: 'ABC-1' }, { items }))).toBe(
      'git: no slot is free, ABC-1 was not started; free one, then resume:\n' +
        'the slot /a has uncommitted changes; commit or remove them\n' +
        'the slot /b is in use by X-1, X-2 mid-turn; let it finish or stop it',
    )
  })

  it('renders through another language', () => {
    const texts: NoticeTexts = { ...en, 'chain.midTurn': (p) => `${p.task} mitten im Zug` }
    expect(renderNotice(notice('chain.midTurn', { task: 'ABC-1' }, { detail: 'x' }), texts)).toBe('ABC-1 mitten im Zug: x')
  })

  it('keeps the notice of a thrown NoticeError and wraps other errors as text', () => {
    const error = fail('chain.noSession', { task: 'ABC-1' })
    expect(error.message).toBe('chain: no session of ABC-1 is known')
    expect(noticeOf(error)).toEqual({ code: 'chain.noSession', params: { task: 'ABC-1' } })
    expect(noticeOf(new Error('boom'))).toEqual(textNotice('boom'))
    expect(noticeOf('raw')).toEqual(textNotice('raw'))
  })

  it('reads old plain strings and unknown codes as text', () => {
    expect(asNotice('chain: old text')).toEqual(textNotice('chain: old text'))
    expect(asNotice({ code: 'chain.noSession', params: { task: 'A-1' } })).toEqual(notice('chain.noSession', { task: 'A-1' }))
    expect(englishOf(asNotice({ code: 'gone.code', params: {} }))).toBe('{"code":"gone.code","params":{}}')
  })

  it('compares notices by value', () => {
    expect(sameNotice(notice('usage.noWeek', {}), notice('usage.noWeek', {}))).toBe(true)
    expect(sameNotice(notice('usage.noWeek', {}), null)).toBe(false)
  })
})
