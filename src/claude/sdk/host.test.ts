import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAlive } from '../../agent/process.js'
import { replyPrompt, type Ask } from '../../sessions/ask.js'
import { replyMove, SdkSessions, sessionOptions, type SdkHostOptions } from './host.js'
import { newPipe, startExecutor } from './pipe.js'

const ask: Ask = {
  id: 'toolu_01',
  questions: [
    { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] },
    { question: 'Which animal?', header: 'Animal', multiSelect: false, options: [{ label: 'Cat', description: '' }, { label: 'Dog', description: '' }] },
  ],
}
const prompt = (answers: Record<string, string>, text = '', files: string[] = []) => replyPrompt({ from: 'page', answers, text, files }, ask, 'en')

describe('replyMove', () => {
  it('answers the pending call with the answers alone', () => {
    expect(replyMove(prompt({ 'Which colour?': 'Red', 'Which animal?': 'Dog' }), ask)).toEqual({
      kind: 'answer',
      answers: { 'Which colour?': 'Red', 'Which animal?': 'Dog' },
    })
  })

  it('refuses the call with the whole reply when the user wrote words or sent files of their own', () => {
    const worded = prompt({ 'Which colour?': 'Red' }, 'Ask me about the animal later.')
    expect(replyMove(worded, ask)).toEqual({ kind: 'deny', message: worded.trim() })
    const filed = prompt({}, '', ['C:\\repos\\example-project\\.temp\\inbox\\shot.png'])
    expect(replyMove(filed, ask)).toEqual({ kind: 'deny', message: filed.trim() })
  })

  it('sends the reply as the next message to a session that waits on no call', () => {
    expect(replyMove('Go on with the task.', null)).toEqual({ kind: 'message' })
  })
})

describe('SdkSessions.stop', () => {
  it('leaves no socket file of the killed executor behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-sdk-'))
    try {
      const sessions = new SdkSessions({ dir, log: () => undefined } as unknown as SdkHostOptions)
      const pipe = newPipe()
      const executor = await startExecutor(pipe, sessions.registry.executorFiles('session-1', 1))
      sessions.registry.save({ sessionId: 'session-1', name: 'ABC-1', cwd: dir, account: 'global', startedAt: 1, executor, pipe, model: null })
      await sessions.stop('session-1')
      expect(isAlive(executor)).toBe(false)
      expect(existsSync(pipe)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

describe('sessionOptions', () => {
  it("appends the project's lone AGENTS.md to Claude Code's system prompt", () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ek-sdk-'))
    try {
      expect(sessionOptions({ name: 'ABC-1', cwd, prompt: 'ABC-1', model: null }).systemPrompt).toBeUndefined()
      writeFileSync(join(cwd, 'AGENTS.md'), 'Run the checks.')
      expect(sessionOptions({ name: 'ABC-1', cwd, prompt: 'ABC-1', model: null }).systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Run the checks.' })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
