import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNT, Harness, PROJECT_ID } from '../e2e/service.fixture.js'
import { NoteServer } from './mcp.fixture.js'
import { ScriptedModel, type LateReply, type Reply } from './model.fixture.js'
import { OPENCODE_ACCOUNT, OPENCODE_MODEL, openCodeAccount, openCodeBinary } from './opencode.fixture.js'

/** Real ms each step of the bench's clock waits: the service polls the real process about ten times faster than live. */
const PACE_MS = 100
/** The service's time a scenario's turn may take: the first start of an account installs the provider's npm package. */
const TURN_LIMIT_MS = 30 * 60_000

describe('the chain on a real OpenCode', { timeout: 10 * 60_000 }, () => {
  let run: Harness
  let model: ScriptedModel
  let notes: NoteServer
  let binary: string

  beforeAll(async () => {
    binary = await openCodeBinary()
  }, 5 * 60_000)

  beforeEach(() => {
    run = new Harness()
    model = new ScriptedModel()
    notes = new NoteServer()
    run.realAgents = ['opencode']
    run.pace = PACE_MS
    run.config.provider = 'opencode'
    run.config.accounts = { claude: ACCOUNT, opencode: OPENCODE_ACCOUNT }
    run.config.models = { opencode: OPENCODE_MODEL }
  })

  afterEach(async () => {
    await run.stop()
    await model.close()
    await notes.close()
  })

  async function start(): Promise<void> {
    const baseURL = await model.start()
    await run.start(() => {
      process.env.EVEN_KEEL_OPENCODE_BIN = binary
      openCodeAccount(join(run.dir, 'opencode-accounts'), baseURL)
    })
  }

  /** The task's branch, read when the model is asked for the merge: Even Keel names it. */
  const branchOf = (task: string) => run.git('for-each-ref', '--format=%(refname:short)', `refs/heads/${task.toLowerCase()}/`)
  const commit = (task: string): Reply => ({ bash: [`git commit --allow-empty -m "[${task}] Work"`] })
  const merge = (task: string) => (): Reply => ({ bash: [`git -C "${run.repo.replaceAll('\\', '/')}" merge --no-edit ${branchOf(task)}`] })
  const work = (task: string) => [commit(task), merge(task), { text: `Merged ${task}.` }]
  const sessionOf = (task: string) => run.service.agents.find((entry) => entry.name === task)
  const asked = (task: string) => model.requests.filter((request) => request.task === task)

  it('runs tasks in the order of their blocks, cleaning up after each Done', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    for (const task of ['ABC-1', 'ABC-2']) model.script(task, ...work(task))
    await start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done', { limitMs: TURN_LIMIT_MS })
    await run.until(() => run.git('branch', '--list', 'abc-*') === '' && run.git('worktree', 'list').split('\n').length === 1, 'the worktrees and branches removed', { limitMs: TURN_LIMIT_MS })

    expect(run.board.status('ABC-1')).toBe('Done')
    expect(run.git('log', '--format=%s', 'main').split('\n')).toEqual(expect.arrayContaining(['[ABC-1] Work', '[ABC-2] Work']))
    expect(model.left('ABC-1') + model.left('ABC-2')).toBe(0)
    // Each request of a turn offers the CLI's own tools: the real process asked, not the scripted agent.
    expect(asked('ABC-2')[0]!.tools).toContain('bash')
    expect(model.requests.findIndex((request) => request.task === 'ABC-2')).toBeGreaterThan(model.requests.findLastIndex((request) => request.task === 'ABC-1'))
  })

  it('closes a task whose turn ends with NO CHANGES, with its comment', async () => {
    run.board.add('ABC-1')
    model.script('ABC-1', { text: 'NO CHANGES: already done in main.' })
    await start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
    expect(run.board.commentsOf('ABC-1').join('\n')).toContain('already done in main.')
    expect(run.git('log', '--format=%s', 'main')).toBe('Initial commit')
  })

  it('resumes the same session with the answer from the chat, and it finishes the task', async () => {
    run.board.add('ABC-1')
    model.script('ABC-1', { text: 'Should the work keep the old format?' }, ...work('ABC-1'))
    await start()
    await run.startChain(PROJECT_ID)

    await run.until(() => model.left('ABC-1') === 3 && sessionOf('ABC-1')?.status === 'idle', 'the question asked', { limitMs: TURN_LIMIT_MS })
    const session = sessionOf('ABC-1')!
    await run.pass(60_000)
    expect(run.board.status('ABC-1')).not.toBe('Done')

    await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId: session.sessionId, ask: null, answers: {}, text: 'Yes, keep it.' })
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })

    expect(sessionOf('ABC-1')?.sessionId ?? session.sessionId).toBe(session.sessionId)
    expect(run.git('log', '--format=%s', 'main')).toContain('[ABC-1] Work')
    await run.until(() => !existsSync(session.cwd), 'the worktree of ABC-1 removed', { limitMs: TURN_LIMIT_MS })
    expect(model.left('ABC-1')).toBe(0)
  })

  it("reaches a package's MCP server through the gateway, which adds its key", async () => {
    run.board.add('ABC-1')
    const note: LateReply = (tools) => {
      const name = tools.find((tool) => tool.endsWith('_note'))
      return name === undefined ? { text: `No note tool among ${tools.join(', ')}` } : { calls: [{ name, args: { text: 'from ABC-1' } }] }
    }
    model.script('ABC-1', note, ...work('ABC-1'))
    await start()
    await run.post('packages/server', { name: 'notes', server: { type: 'http', url: await notes.start(), headers: { Authorization: 'Bearer ${NOTES_TOKEN}' } }, project: PROJECT_ID })
    await run.post('packages/key', { name: 'NOTES_TOKEN', value: 'token-1' })
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
    expect(notes.calls).toEqual([expect.objectContaining({ args: { text: 'from ABC-1' }, headers: expect.objectContaining({ authorization: 'Bearer token-1' }) })])
    expect(model.requests.find((request) => request.task === 'ABC-1')!.tools.filter((tool) => tool.endsWith('_note'))).toHaveLength(1)
  })
})
