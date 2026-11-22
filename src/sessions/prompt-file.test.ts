import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandLineFits, expandPromptFile, PROMPT_DIR, promptPointer, writePromptFile } from './prompt-file.js'

const binary = 'C:\\Users\\someone\\.local\\bin\\claude.exe'

describe('commandLineFits', () => {
  it('takes a Windows line well under 32,767 characters', () => {
    expect(commandLineFits(binary, ['--bg', '-n', 'ABC-1', 'x'.repeat(26_000)], 'win32')).toBe(true)
  })

  // BTN-1505: a 26,577-character handoff prompt went, the next one longer failed with `spawn ENAMETOOLONG`.
  it('refuses a Windows line of more than 32,767 characters', () => {
    expect(commandLineFits(binary, ['--bg', 'x'.repeat(33_000)], 'win32')).toBe(false)
  })

  it('keeps room on Windows for what the daemon wraps the line in', () => {
    expect(commandLineFits(binary, ['x'.repeat(32_700)], 'win32')).toBe(false)
  })

  it('counts the escapes of quotes and backslashes on Windows', () => {
    const quoted = '"\\ '.repeat(10_000)
    expect(quoted.length).toBeLessThan(32_767 - 1_000)
    expect(commandLineFits(binary, [quoted], 'win32')).toBe(false)
  })

  it('counts Cyrillic in bytes elsewhere: one argument holds 128 KiB', () => {
    expect(commandLineFits('/usr/bin/claude', ['ж'.repeat(60_000)], 'linux')).toBe(true)
    expect(commandLineFits('/usr/bin/claude', ['ж'.repeat(70_000)], 'linux')).toBe(false)
  })
})

describe('a prompt in a file', () => {
  let cwd: string
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'even-keel-prompt-file-'))
  })
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('is written whole under the folder\'s .temp, its path relative with forward slashes', async () => {
    const prompt = 'Задача ABC-1\n- "вопрос" → ответ\n'.repeat(2_000)
    const path = await writePromptFile(cwd, prompt, 1_700_000_000_000)
    expect(path).toMatch(new RegExp(`^${PROMPT_DIR}/prompt-1700000000000-[0-9a-f]{8}\\.md$`))
    expect(await readFile(join(cwd, path), 'utf8')).toBe(prompt)
  })

  it('stands in the feed for its pointer while the file is there', async () => {
    const prompt = 'Задача ABC-1\nцеликом'
    const pointer = promptPointer(await writePromptFile(cwd, prompt))
    expect(pointer.length).toBeLessThan(300)
    expect(expandPromptFile(pointer, cwd)).toBe(prompt)
    expect(expandPromptFile(`${pointer}\n`, cwd)).toBe(prompt)
  })

  it('leaves the pointer when the file went with its worktree, or no folder is known', async () => {
    const pointer = promptPointer(`${PROMPT_DIR}/prompt-1-abcdef01.md`)
    expect(expandPromptFile(pointer, cwd)).toBe(pointer)
    expect(expandPromptFile(pointer, undefined)).toBe(pointer)
  })

  it('reads no path the pointer could not have', () => {
    const pointer = promptPointer('.temp/even-keel-prompts/../../secret.md')
    expect(expandPromptFile(pointer, cwd)).toBe(pointer)
    expect(expandPromptFile('an ordinary prompt', cwd)).toBe('an ordinary prompt')
  })
})
