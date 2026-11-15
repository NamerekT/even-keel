import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnContext } from '../agent/scripted.js'
import { demoReadme, demoTurn } from './scenario.js'

describe('a demo turn in a folder without git (EKR-108)', () => {
  let folder: string
  let git: ReturnType<typeof vi.fn<TurnContext['git']>>
  const shown: string[] = []

  const context = (task: string): TurnContext =>
    ({
      task,
      sessionId: 'demo-session',
      cwd: folder,
      repo: folder,
      prompt: '',
      git,
      pause: async () => {},
      live: () => true,
      show: (step: { text: string }) => void shown.push(step.text),
    }) as unknown as TurnContext

  beforeEach(() => {
    const temp = join(process.cwd(), '.temp')
    mkdirSync(temp, { recursive: true })
    folder = mkdtempSync(join(temp, 'demo-plain-'))
    writeFileSync(join(folder, 'README.md'), demoReadme('en'))
    git = vi.fn<TurnContext['git']>()
    shown.length = 0
  })

  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  it('writes the file in the folder and closes the task by the mark, with no commit or merge', async () => {
    const end = await demoTurn('welcome', 0, () => 'en')(context('DEMO-1'))

    expect(readFileSync(join(folder, 'README.md'), 'utf8')).toContain('Welcome aboard')
    expect(git).not.toHaveBeenCalled()
    expect(shown.some((text) => text.startsWith('git '))).toBe(false)
    expect(end).toEqual({ done: expect.stringContaining('DEMO-1') })
    expect('done' in end && end.done).not.toContain('merged')
  })

  it('asks its question first, as with git', async () => {
    const end = await demoTurn('tone', 0, () => 'en')(context('DEMO-3'))
    expect(end).toMatchObject({ ask: 'Which tone should the greeting take?' })
  })
})
