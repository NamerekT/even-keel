import { describe, expect, it } from 'vitest'
import { englishOf, notice, renderNotice, type Notice } from '../../../src/notice/notice.js'
import { noticesEn } from './notices-en.js'

const page = (shown: Notice) => renderNotice(shown, noticesEn)

describe('noticesEn', () => {
  it("drops the log's area prefix", () => {
    expect(page(notice('account.usedByApp', { app: 'VS Code' }))).toBe('VS Code uses this account; switch it to another one first')
    expect(page(notice('chain.noSession', { task: 'ABC-1' }))).toBe('no session of ABC-1 is known')
    expect(englishOf(notice('account.usedByApp', { app: 'VS Code' }))).toMatch(/^claude: /)
  })

  it("names Codex and keeps the prompt's area prefix", () => {
    expect(page(notice('account.codexHomeKept', {}))).toMatch(/^Codex's own account/)
    expect(page(notice('prompt.empty', { before: 'x', value: 'null' }))).toMatch(/^prompt: /)
  })
})
