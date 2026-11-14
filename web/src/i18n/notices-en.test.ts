import { describe, expect, it } from 'vitest'
import { englishOf, notice, renderNotice, type Notice } from '../../../src/notice/notice.js'
import { noticesEn } from './notices-en.js'
import { noticesRu } from './notices-ru.js'

const page = (shown: Notice) => renderNotice(shown, noticesEn)

describe('noticesEn', () => {
  it("drops the log's area prefix", () => {
    expect(page(notice('account.usedByApp', { app: 'VS Code' }))).toBe('VS Code uses this account; switch it to another one first')
    expect(page(notice('chain.noSession', { task: 'ABC-1' }))).toBe('no session of ABC-1 is known')
    expect(englishOf(notice('account.usedByApp', { app: 'VS Code' }))).toMatch(/^claude: /)
  })

  it('names eight models of a missing one and counts the rest, in both languages', () => {
    const known = Array.from({ length: 11 }, (_, at) => `openai/m${at}`)
    const refused = notice('chain.unknownModel', { task: 'ABC-1', model: 'openai/x', agent: 'OpenCode', account: 'Demo', known })
    expect(page(refused)).toContain('it has openai/m0, openai/m1, openai/m2, openai/m3, openai/m4, openai/m5, openai/m6, openai/m7 and 3 more)')
    expect(renderNotice(refused, noticesRu)).toContain('есть openai/m0, openai/m1, openai/m2, openai/m3, openai/m4, openai/m5, openai/m6, openai/m7 и ещё 3.')
    const few = notice('chain.unknownModel', { task: 'ABC-1', model: 'openai/x', agent: 'OpenCode', account: 'Demo', known: known.slice(0, 8) })
    expect(page(few)).toContain('it has openai/m0, openai/m1, openai/m2, openai/m3, openai/m4, openai/m5, openai/m6, openai/m7)')
    expect(renderNotice(few, noticesRu)).toContain('openai/m7.')
  })

  it("names Codex and keeps the prompt's area prefix", () => {
    expect(page(notice('account.codexHomeKept', {}))).toMatch(/^Codex's own account/)
    expect(page(notice('prompt.empty', { before: 'x', value: 'null' }))).toMatch(/^prompt: /)
  })

  it('shows the PR note refusal and recovery action in both languages, and reads old notices', () => {
    const refused = notice('review.noNote', { path: '.temp/pull.md', reason: 'tooLarge', limit: 65_536 })
    expect(page(refused)).toContain('65536 bytes')
    expect(page(refused)).toContain('press Resume')
    expect(renderNotice(refused, noticesRu)).toContain('65536 байт')
    expect(renderNotice(refused, noticesRu)).toContain('«Снять с паузы»')
    expect(page(notice('review.noNote', { path: 'old.md' }))).toBe('the session left no pull request description at old.md')
  })

  it('does not tell to fix access when the pause is on a refused PR note, in both languages (BTN-1148)', () => {
    const cause = notice('review.noNote', { path: '.env.local', reason: 'secret', limit: 65_536 })
    const paused = notice('review.notOpened', { task: 'ABC-1', note: true }, { cause })
    expect(page(paused)).toMatch(/^the pull request of ABC-1 was not opened: PR description \.env\.local refused: /)
    expect(page(paused)).not.toContain('access')
    expect(renderNotice(paused, noticesRu)).toMatch(/^pull request задачи ABC-1 не открыт: описание PR \.env\.local отклонено: /)
    expect(renderNotice(paused, noticesRu)).not.toContain('доступ')
    expect(page(notice('review.notOpened', { task: 'ABC-1' }))).toContain('fix access')
  })
})
