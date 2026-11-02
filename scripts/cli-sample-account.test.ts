import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountLeaks, accountTexts } from './cli-sample-account.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const INSTRUCTION = 'John Doe prefers answers in Esperanto and short summaries.'
const MEMORY = '- [Garden plans](garden.md) — John Doe plants tomatoes "every" spring'
const CODEX_MEMORY = 'John Doe keeps the receipts of example.com in a shoebox under the desk.'
const SKILL = "John Doe's way of filing receipts from the shoebox, month by month."

function accountFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-account-'))
  dirs.push(dir)
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  write('CLAUDE.md', `# Rules\n\n- Short line.\n${INSTRUCTION}\r\n`)
  write('projects/D--example-project/memory/MEMORY.md', `${MEMORY}\n`)
  write('memories/memory_summary.md', `${CODEX_MEMORY}\n`)
  write('memories/.git/description', `${INSTRUCTION} in git\n`)
  write('skills/receipts/SKILL.md', `---\nname: receipts\ndescription: "${SKILL}"\n---\n\nShort body.\n`)
  write('skills/receipts/notes.txt', `${INSTRUCTION} in a skill's own file\n`)
  write('sessions/old.jsonl', `${INSTRUCTION} in a session\n`)
  return dir
}

/** As a transcript holds them: event lines of JSON inside the sample, the injected text inside a message. */
function sample(...texts: string[]) {
  const events = texts.map((text) => JSON.stringify({ type: 'user', message: { content: `<system-reminder>\n${text}\n</system-reminder>` } }))
  return { provider: 'claude', snapshots: [{ phase: 'question', raw: { jsonl: events.join('\n') } }] }
}

describe('account folder text in a CLI capture', () => {
  const files = (dir: string) => [
    join(dir, 'CLAUDE.md'), join(dir, 'memories/memory_summary.md'), join(dir, 'projects/D--example-project/memory/MEMORY.md'),
    join(dir, 'skills/receipts/SKILL.md'),
  ].sort()

  it('reads the global instructions, Claude memory, Codex memories and own skills, not the rest of the folder', () => {
    const dir = accountFolder()
    const texts = accountTexts(dir)
    expect(texts.map((each) => each.file).sort()).toEqual(files(dir))
    expect(texts.find((each) => each.file.endsWith('CLAUDE.md'))!.lines).toEqual([INSTRUCTION])
    expect(texts.find((each) => each.file.endsWith('SKILL.md'))!.lines).toEqual([SKILL])
  })

  it('names every file whose long line the capture holds, through nested JSON and escaped quotes', () => {
    const dir = accountFolder()
    const leaks = accountLeaks(sample(INSTRUCTION, MEMORY, CODEX_MEMORY, `- receipts: ${SKILL}`), accountTexts(dir))
    expect(leaks.sort()).toEqual(files(dir))
  })

  it('passes a capture with none of them, and short lines that any text may hold', () => {
    const dir = accountFolder()
    expect(accountLeaks(sample('Which colour? Red or Blue?', '- Short line.', '# Rules'), accountTexts(dir))).toEqual([])
  })

  it('takes a missing folder as one with nothing in it', () => {
    expect(accountTexts(join(tmpdir(), 'cli-account-missing-folder'))).toEqual([])
  })
})
