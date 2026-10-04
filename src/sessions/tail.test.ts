import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { projectDirName } from './paths.js'
import { TranscriptTail } from './tail.js'

const SESSION = '86e70ef5-0000-4000-8000-000000000001'
const ROOT = 'C:\\repos\\example'
const WORKTREE = 'C:\\repos\\example\\.claude\\worktrees\\abc-1'

const line = (id: string, text: string) =>
  `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-01-01T10:00:00Z',
    message: { id, content: [{ type: 'text', text }] },
  })}\n`

const agent = (cwd: string): AgentEntry => ({ sessionId: SESSION, cwd, kind: 'background', startedAt: 0 })
const texts = (tail: TranscriptTail) => tail.fold.summary().feed.map((entry) => entry.text)

describe('TranscriptTail', () => {
  let projects: string
  const fileIn = (cwd: string) => join(projects, projectDirName(cwd), `${SESSION}.jsonl`)
  const write = (cwd: string, content: string) => {
    mkdirSync(join(projects, projectDirName(cwd)), { recursive: true })
    writeFileSync(fileIn(cwd), content)
  }
  const move = (from: string, to: string, extra: string) => {
    mkdirSync(join(projects, projectDirName(to)), { recursive: true })
    renameSync(fileIn(from), fileIn(to))
    appendFileSync(fileIn(to), extra)
  }

  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'even-keel-projects-'))
  })

  afterEach(() => {
    rmSync(projects, { recursive: true, force: true })
  })

  it('reads new lines as the session appends them', async () => {
    write(ROOT, line('m1', 'first'))
    const tail = new TranscriptTail(projects, agent(ROOT))
    await tail.read()
    appendFileSync(fileIn(ROOT), line('m2', 'second'))
    await tail.read()

    expect(texts(tail)).toEqual(['first', 'second'])
  })

  it('follows the transcript when the session moves into a worktree', async () => {
    write(ROOT, line('m1', 'first'))
    const tail = new TranscriptTail(projects, agent(ROOT))
    await tail.read()

    move(ROOT, WORKTREE, line('m2', 'in worktree'))
    await tail.read()

    expect(texts(tail)).toEqual(['first', 'in worktree'])
  })

  it('switches to the directory of the current cwd when both copies exist', async () => {
    write(ROOT, line('m1', 'first'))
    const tail = new TranscriptTail(projects, agent(ROOT))
    await tail.read()

    write(WORKTREE, line('m1', 'first') + line('m2', 'in worktree'))
    tail.follow(agent(WORKTREE))
    await tail.read()

    expect(texts(tail)).toEqual(['first', 'in worktree'])
  })

  it('rereads the transcript when it comes back rewritten under the same path', async () => {
    write(ROOT, line('m1', 'first') + line('m2', 'second'))
    const tail = new TranscriptTail(projects, agent(ROOT))
    await tail.read()

    move(ROOT, WORKTREE, '')
    await tail.read()
    rmSync(fileIn(WORKTREE))
    write(ROOT, line('m1', 'first') + line('m2', 'second') + line('m3', 'back in root'))
    await tail.read()

    expect(texts(tail)).toEqual(['first', 'second', 'back in root'])
  })

  it('waits quietly while the transcript is nowhere to be found', async () => {
    write(ROOT, line('m1', 'first'))
    const tail = new TranscriptTail(projects, agent(ROOT))
    await tail.read()
    rmSync(fileIn(ROOT))

    await expect(tail.read()).resolves.toBeUndefined()
    expect(texts(tail)).toEqual(['first'])
  })
})
