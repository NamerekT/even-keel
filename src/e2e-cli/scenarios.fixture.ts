import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from 'vitest'
import { Harness, PROJECT_ID } from '../e2e/service.fixture.js'
import type { CliKit } from './kit.fixture.js'
import { NoteServer } from './mcp.fixture.js'
import { ScriptedModel, type LateReply, type Reply } from './model.fixture.js'

/** Real ms each step of the bench's clock waits: the service polls the real process about ten times faster than live. */
const PACE_MS = 100
/** The service's time a scenario's turn may take: the first start of an account installs or starts what it needs. */
const TURN_LIMIT_MS = 30 * 60_000
/** The words `merge-check` opens its refusal with (`plugins/checkpoint/hooks/merges.mjs`, `refusal`). */
const REFUSED = "Even Keel's check before the merge failed"
/** A project's check that passes once the branch's last commit is a fix: committed in the bench's checkout. */
const CHECK_SCRIPT = "import { execFileSync } from 'node:child_process'\nprocess.exit(execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).includes('Fix') ? 0 : 1)\n"

/** The chain's scenarios on one real CLI with the scripted model (`docs/chain/e2e.md`, "Real CLIs"). */
export function chainOnRealCli(kit: CliKit): void {
  describe(`the chain on a real ${kit.title}`, { timeout: 10 * 60_000 }, () => {
    let run: Harness
    let model: ScriptedModel
    let notes: NoteServer
    let binary: string

    beforeAll(async () => {
      binary = await kit.binary()
    }, 5 * 60_000)

    beforeEach(() => {
      run = new Harness()
      model = new ScriptedModel()
      notes = new NoteServer()
      run.realAgents = [kit.agent]
      run.pace = PACE_MS
      kit.configure(run)
      // What the real CLI asked: the only trace of a turn that went its own way.
      onTestFailed(() => {
        for (const request of model.requests) console.log(`model: ${request.task ?? request.side ?? '?'} [${request.tools.join(' ')}] → ${JSON.stringify(request.reply).slice(0, 200)} | ${request.result.slice(0, 300)}`)
      })
    })

    afterEach(async () => {
      kit.release?.(run, binary)
      await run.stop()
      await model.close()
      await notes.close()
    })

    async function start(prepared?: () => void): Promise<void> {
      const baseURL = await model.start()
      await run.start(() => {
        kit.prepare(run, binary, baseURL)
        // The hooks reach the service only through this variable, which it does not give its sessions yet (BTN-817).
        process.env.EVEN_KEEL_URL = `http://127.0.0.1:${process.env.EVEN_KEEL_PORT}`
        prepared?.()
      })
      // A real CLI tells its sign-in slower than the first Start: an account not read yet is an expired login to it.
      const read = () => run.service.account.view.accounts
      await run.until(() => read().length > 0 && read().every((entry) => entry.status !== null || entry.error !== null), 'the accounts read', { limitMs: TURN_LIMIT_MS })    }

    /** The task's branch, read when the model is asked for the merge: Even Keel names it. */
    const branchOf = (task: string) => run.git('for-each-ref', '--format=%(refname:short)', `refs/heads/${task.toLowerCase()}/`)
    const commit = (task: string, what = 'Work'): Reply => ({ bash: [`git commit --allow-empty -m "[${task}] ${what}"`] })
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
      expect(asked('ABC-2')[0]!.tools.length).toBeGreaterThan(0)
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

    it('resumes the session with the answer from the chat, and it finishes the task', async () => {
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
      // Claude's `--bg` session asks the model before its MCP servers connect: the tool comes in a later request.
      let waits = 0
      const note: LateReply = (tools) => {
        const name = tools.find((tool) => tool.endsWith('_note'))
        if (name !== undefined) return { calls: [{ name, args: { text: 'from ABC-1' } }] }
        return waits++ < 3 ? { wait: { bash: ['git status --short'] } } : { text: `No note tool among ${tools.join(', ')}` }
      }
      model.script('ABC-1', note, ...work('ABC-1'))
      await start()
      await run.post('packages/server', { name: 'notes', server: { type: 'http', url: await notes.start(), headers: { Authorization: 'Bearer ${NOTES_TOKEN}' } }, project: PROJECT_ID })
      await run.post('packages/key', { name: 'NOTES_TOKEN', value: 'token-1' })
      await run.startChain(PROJECT_ID)

      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
      expect(notes.calls).toEqual([expect.objectContaining({ args: { text: 'from ABC-1' }, headers: expect.objectContaining({ authorization: 'Bearer token-1' }) })])
      expect(asked('ABC-1').find((request) => request.tools.some((tool) => tool.endsWith('_note')))?.tools.filter((tool) => tool.endsWith('_note'))).toHaveLength(1)
    })

    it("holds the merge until the project's check passes, by the checkpoint plugin's hook", async () => {
      run.board.add('ABC-1')
      run.project.commands = { check: ['node check.mjs'] }
      const fix: LateReply = (_tools, result) => (result.includes(REFUSED) ? commit('ABC-1', 'Fix') : { text: `The merge was not refused: ${result.slice(0, 300)}` })
      model.script('ABC-1', commit('ABC-1'), merge('ABC-1'), fix, merge('ABC-1'), { text: 'Merged ABC-1.' })
      await start(() => {
        writeFileSync(join(run.repo, 'check.mjs'), CHECK_SCRIPT)
        run.git('add', 'check.mjs')
        run.git('commit', '-q', '-m', 'Add the check')
      })
      await run.post('packages/plugin', { plugin: 'checkpoint', marketplace: 'even-keel', project: PROJECT_ID })
      await run.until(() => run.service.packages.unready(PROJECT_ID).length === 0, 'the checkpoint package installed', { limitMs: TURN_LIMIT_MS })
      await run.startChain(PROJECT_ID)

      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
      expect(asked('ABC-1').some((request) => request.result.includes(REFUSED))).toBe(true)
      expect(run.git('log', '--format=%s', 'main').split('\n')).toEqual(expect.arrayContaining(['[ABC-1] Work', '[ABC-1] Fix']))
      expect(model.left('ABC-1')).toBe(0)
    })
  })
}
