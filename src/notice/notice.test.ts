import { describe, expect, it } from 'vitest'
import { asNotice, causeLine, englishOf, fail, notice, noticeOf, noticeWithCause, renderNotice, sameNotice, textNotice, withLabels, type Notice, type NoticeTexts } from './notice.js'
import { AGENTS } from '../agent/adapters.js'
import { AGENT_NAMES, en } from './en.js'

describe('withLabels', () => {
  it('shows every project id in a text by its label, and leaves the rest as it is (BTN-271)', () => {
    const labels = { '11111111-1111-4111-8111-111111111111': 'ABC (main)', '22222222-2222-4222-8222-222222222222': 'ABC (release/v1)' }
    const text = 'forward: 22222222-2222-4222-8222-222222222222 carried 2 commit(s) into main of 11111111-1111-4111-8111-111111111111'
    expect(withLabels(text, labels)).toBe('forward: ABC (release/v1) carried 2 commit(s) into main of ABC (main)')
    expect(withLabels('chain: XYZ ended', labels)).toBe('chain: XYZ ended')
  })
})

it('names every agent as its adapter does', () => {
  expect(AGENT_NAMES).toEqual(Object.fromEntries(Object.entries(AGENTS).map(([name, adapter]) => [name, adapter.title])))
})

describe('notices', () => {
  it('renders profile messages without a service prefix', () => {
    expect(englishOf(notice('profiles.refused', { tracker: 'Jira' }))).toBe('Jira refused the credentials')
    expect(englishOf(notice('profiles.unknown', {}))).toBe('there is no such profile; the page may be out of date')
    expect(englishOf(notice('profiles.inUse', { profile: 'Work', projects: 'ABC' }))).toBe('Work is used by ABC; it cannot be removed')
  })

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

  it('puts a cause after a whole sentence as the next one, not after a colon', () => {
    const cause = notice('copilot.startFailed', { task: 'ABC-1', cwd: '/w' }, { detail: 'spawn x ENOENT' })
    expect(englishOf(notice('copilot.binaryMissing', { bin: 'x' }, { cause }))).toBe(
      `${en['copilot.binaryMissing']({ bin: 'x' })} ${en['copilot.startFailed']({ task: 'ABC-1', cwd: '/w' })}: spawn x ENOENT`,
    )
    expect(englishOf(notice('copilot.binaryMissing', { bin: 'x' }, { detail: 'line 1\nline 2' }))).toBe(`${en['copilot.binaryMissing']({ bin: 'x' })}\nline 1\nline 2`)
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

  it('shows the plain error under a notice as its detail and as a log line (BTN-674)', () => {
    const locked = Object.assign(new Error("EPERM: operation not permitted, rename 'a.import' -> 'a'"), { code: 'EPERM', path: 'a.import', dest: 'a' })
    const error = fail('storage.importFailed', { file: 'a' }, {}, { cause: locked })
    expect(noticeWithCause(error)).toEqual({ code: 'storage.importFailed', params: { file: 'a' }, detail: locked.message })
    expect(englishOf(noticeWithCause(error))).toContain('files are as they were: EPERM: operation not permitted')
    expect(causeLine(error)).toBe(`cause: ${locked.message}`)

    const bare = fail('storage.importFailed', { file: 'a' }, {}, { cause: Object.assign(new Error('locked'), { code: 'EBUSY', path: 'D:/state' }) })
    expect(causeLine(bare)).toBe('cause: locked (code EBUSY, path D:/state)')
    expect(causeLine(fail('storage.importFailed', { file: 'a' }, {}, { cause: 'gone' }))).toBe('cause: gone')
  })

  it('leaves a notice without a plain error under it as it is', () => {
    const plain = fail('chain.noSession', { task: 'ABC-1' })
    expect(noticeWithCause(plain)).toEqual(noticeOf(plain))
    expect(causeLine(plain)).toBeUndefined()
    const nested = fail('storage.importFailed', { file: 'a' }, {}, { cause: plain })
    expect(noticeWithCause(nested)).toEqual(noticeOf(nested))
    expect(causeLine(nested)).toBeUndefined()
    const detailed = fail('storage.importFailed', { file: 'a' }, { detail: 'own' }, { cause: new Error('under') })
    expect(noticeWithCause(detailed).detail).toBe('own')
    expect(causeLine(detailed)).toBe('cause: under')
    expect(noticeWithCause(new Error('boom'))).toEqual(textNotice('boom'))
  })

  it('reads old plain strings and unknown codes as text', () => {
    expect(asNotice('chain: old text')).toEqual(textNotice('chain: old text'))
    expect(asNotice({ code: 'chain.noSession', params: { task: 'A-1' } })).toEqual(notice('chain.noSession', { task: 'A-1' }))
    expect(englishOf(asNotice({ code: 'gone.code', params: {} }))).toBe('{"code":"gone.code","params":{}}')
  })

  it('renders a code that is only an inherited member of the texts as the code itself', () => {
    expect(renderNotice({ code: 'constructor', params: {} } as Notice, en)).toBe('constructor')
    expect(renderNotice({ code: 'toString', params: {} } as Notice, en)).toBe('toString')
  })

  it('compares notices by value', () => {
    expect(sameNotice(notice('usage.noWeek', {}), notice('usage.noWeek', {}))).toBe(true)
    expect(sameNotice(notice('usage.noWeek', {}), null)).toBe(false)
  })
})
