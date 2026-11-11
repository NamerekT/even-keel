import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed, type TestContext } from 'vitest'
import { Harness, PROJECT_ID } from '../e2e/service.fixture.js'
import { AGENTS_MD_FLAG, claudeRulesAbove, remoteDefaults } from './claude.fixture.js'
import type { CliKit } from './kit.fixture.js'
import { NoteServer } from './mcp.fixture.js'
import { ScriptedModel, type LateReply, type ModelRequest, type Reply } from './model.fixture.js'

/** Real ms each step of the bench's clock waits: the service polls the real process about ten times faster than live. */
const PACE_MS = 100
/** The service's time a scenario's turn may take: the first start of an account installs or starts what it needs. */
const TURN_LIMIT_MS = 30 * 60_000
/** The words `merge-check` opens its refusal with (`plugins/agent-bridge/hooks/merges.mjs`, `refusal`). */
const REFUSED = "Even Keel's check before the merge failed"
/** Words of a project's `AGENTS.md` and `CLAUDE.md` that nothing else in a request says. */
const AGENTS_WORD = 'ZEBRAFINCH'
const CLAUDE_WORD = 'MARMOSET'
/** A word of a chat message that nothing else in a request says. */
const MAIL_WORD = 'PANGOLIN'
/** The project's pinned checkpoint threshold (the least the setting takes) and a context past it, short of the late one. */
const CHECKPOINT_AT = 100_000
const FULL_CONTEXT = 120_000
/** How the agent-bridge hook's nudge opens (`plugins/agent-bridge/hooks/nudges.mjs`, `nudge`) and what it asks for. */
const NUDGED = `Context is now ~${FULL_CONTEXT / 1000}k tokens`
const CHECKPOINT_LINE = 'CHECKPOINT: .temp/handoff.md'
/** The real time a scripted turn keeps working while it waits for a hook's word. */
const WAIT_MS = 3 * 60_000
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
      await kit.release?.(run, binary)
      await run.stop()
      await model.close()
      await notes.close()
    })

    async function start(prepared?: () => void): Promise<void> {
      const baseURL = await model.start()
      await run.start(() => {
        kit.prepare(run, binary, baseURL)
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
    /** The task's session as the chain sees it, of the kit's kind: an adapter may start another kind when it cannot run that one. */
    const liveSession = (task: string) => {
      const session = sessionOf(task)!
      if (kit.kind !== undefined) expect(session.kind).toBe(kit.kind)
      return session
    }
    const asked = (task: string) => model.requests.filter((request) => request.task === task)
    /**
     * Waits for the task's script to be played out. The branch lands in main at the merge's tool call, so Done can come
     * before the CLI asks for the report after it; the session is stopped only once that turn ends (BTN-870).
     */
    const playedOut = (task: string) => run.until(() => model.left(task) === 0, `the last reply of ${task} taken`, { limitMs: TURN_LIMIT_MS })

    /** Waits for Even Keel's built-in `agent-bridge` plugin, which every project has (BTN-986), to install. */
    async function bridgeInstalled(): Promise<void> {
      await run.until(() => run.service.packages.unready(PROJECT_ID).length === 0, 'the agent-bridge package installed', { limitMs: TURN_LIMIT_MS })
    }

    /**
     * Keeps the turn working with `git status`, each answer reporting `tokens`, until a request's text shows `seen`, then
     * answers `then`; past `WAIT_MS` of real time it ends the turn saying what never came.
     */
    function awaiting(seen: string, what: string, then: Reply, tokens?: number): LateReply {
      let deadline: number | undefined
      return (_tools, _result, context) => {
        deadline ??= Date.now() + WAIT_MS
        if (context.includes(seen)) return then
        if (Date.now() > deadline) return { text: `Never got ${what}.` }
        return { wait: { bash: ['git status --short'], ...(tokens === undefined ? {} : { tokens }) } }
      }
    }

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
      const session = liveSession('ABC-1')
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

    it("holds the merge until the project's check passes, by the agent-bridge plugin's hook", async () => {
      run.board.add('ABC-1')
      run.project.commands = { check: ['node check.mjs'] }
      const fix: LateReply = (_tools, result) => (result.includes(REFUSED) ? commit('ABC-1', 'Fix') : { text: `The merge was not refused: ${result.slice(0, 300)}` })
      model.script('ABC-1', commit('ABC-1'), merge('ABC-1'), fix, merge('ABC-1'), { text: 'Merged ABC-1.' })
      await start(() => {
        writeFileSync(join(run.repo, 'check.mjs'), CHECK_SCRIPT)
        run.git('add', 'check.mjs')
        run.git('commit', '-q', '-m', 'Add the check')
      })
      await bridgeInstalled()
      await run.startChain(PROJECT_ID)

      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
      expect(asked('ABC-1').some((request) => request.result.includes(REFUSED))).toBe(true)
      expect(run.git('log', '--format=%s', 'main').split('\n')).toEqual(expect.arrayContaining(['[ABC-1] Work', '[ABC-1] Fix']))
      await playedOut('ABC-1')
    })

    /**
     * A session that steers (`AgentEntry.steers`, an SDK session) takes the message on its stdin at once, so the mailbox
     * stays empty and the CLI hands the message to the model within the same turn.
     */
    it("hands a chat message to the working session mid-turn, by the agent-bridge plugin's mailbox hook or the session's own input", async () => {
      run.board.add('ABC-1')
      model.script('ABC-1', awaiting(MAIL_WORD, 'the chat message', commit('ABC-1')), merge('ABC-1'), { text: 'Merged ABC-1.' })
      await start()
      await bridgeInstalled()
      await run.startChain(PROJECT_ID)

      // The page's chat sends into the mailbox once the session's hook has asked for mail and its turn is on.
      const listening = () => {
        const id = sessionOf('ABC-1')?.sessionId
        return id !== undefined && run.service.mailbox.listens(id) && run.service.agentStatus('ABC-1') === 'busy'
      }
      await run.until(listening, 'the mailbox hook of ABC-1 asked mid-turn', { limitMs: TURN_LIMIT_MS })
      const session = liveSession('ABC-1')
      await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId: session.sessionId, ask: null, answers: {}, text: `The code word is ${MAIL_WORD}.` })
      const steers = session.steers === true
      expect(run.service.mailbox.of(session.sessionId)).toEqual(steers ? [] : [expect.objectContaining({ fate: 'waiting' })])

      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
      // Delivered by a hook of the turn, not by a resume after it.
      if (!steers) expect(run.service.mailbox.of(session.sessionId)[0]).toMatchObject({ fate: 'delivered', event: expect.stringMatching(/^(PreToolUse|PostToolUse|Stop)$/) })
      expect(asked('ABC-1').some((request) => request.context.includes(MAIL_WORD))).toBe(true)
      expect(run.git('log', '--format=%s', 'main')).toContain('[ABC-1] Work')
      await playedOut('ABC-1')
    })

    it("asks the session for a checkpoint once its context passes the project's threshold, by the agent-bridge plugin's hook", async () => {
      run.board.add('ABC-1')
      run.project.stats = { checkpointTokens: CHECKPOINT_AT }
      // Even Keel reads the context from the transcript at its poll: the hook nudges at the first tool call after it.
      model.script('ABC-1', awaiting(NUDGED, 'the checkpoint nudge', commit('ABC-1'), FULL_CONTEXT), merge('ABC-1'), { text: 'Merged ABC-1.' })
      await start()
      await bridgeInstalled()
      await run.startChain(PROJECT_ID)

      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
      const nudged = asked('ABC-1').find((request) => request.context.includes(NUDGED))
      expect(nudged?.context).toContain(CHECKPOINT_LINE)
      expect(run.git('log', '--format=%s', 'main')).toContain('[ABC-1] Work')
      await playedOut('ABC-1')
    })

    /**
     * Commits the rules files to `main` and runs one task to `NO CHANGES` on the CLI's remote defaults; the first request
     * of its session and the flags the CLI fetched. Skipped below a project rules file of Claude's, which the CLI reads too.
     */
    async function rulesRun(context: TestContext, files: Record<string, string>): Promise<{ first: ModelRequest; flags: Record<string, unknown> }> {
      const above = claudeRulesAbove(run.dir)
      if (above !== null) context.skip(`${above} is above the bench's folder, so no AGENTS.md below it is lone: set TEMP to a folder with none above`)
      run.board.add('ABC-1')
      model.script('ABC-1', { text: 'NO CHANGES: nothing to do.' })
      let fetched: Promise<Record<string, unknown>> | undefined
      await start(() => {
        for (const [name, text] of Object.entries(files)) writeFileSync(join(run.repo, name), text)
        run.git('add', '.')
        run.git('commit', '-q', '-m', 'Add the rules')
        fetched = remoteDefaults(run, binary)
      })
      const flags = await fetched!
      // Without them the scenario checks only the built-in default, and a remote switch would pass unseen.
      expect(Object.keys(flags).length, "the remote defaults the CLI fetched from Anthropic's servers").toBeGreaterThan(0)
      await run.startChain(PROJECT_ID)
      await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done', { limitMs: TURN_LIMIT_MS })
      // A session on the remote defaults takes longer to quit, and holds its worktree until it does.
      await run.until(() => run.git('worktree', 'list').split('\n').length === 1, 'the worktree removed', { limitMs: TURN_LIMIT_MS })
      return { first: asked('ABC-1')[0]!, flags }
    }

    it.runIf(kit.agent === 'claude')('gives the session a lone AGENTS.md, as the CLI reads it on its remote defaults', async (context) => {
      const { first, flags } = await rulesRun(context, { 'AGENTS.md': `# Rules\n\nThe code word is ${AGENTS_WORD}.\n` })
      expect(first.context, `the AGENTS.md word in the first request (${AGENTS_MD_FLAG}: ${JSON.stringify(flags[AGENTS_MD_FLAG])})`).toContain(AGENTS_WORD)
    })

    it.runIf(kit.agent === 'claude')('gives the session CLAUDE.md and not AGENTS.md when both are there', async (context) => {
      const { first } = await rulesRun(context, { 'AGENTS.md': `# Rules\n\nThe code word is ${AGENTS_WORD}.\n`, 'CLAUDE.md': `# Rules\n\nThe code word is ${CLAUDE_WORD}.\n` })
      expect(first.context).toContain(CLAUDE_WORD)
      expect(first.context).not.toContain(AGENTS_WORD)
    })
  })
}
