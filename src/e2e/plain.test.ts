import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ends, Gate, parked } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('a project without git', { timeout: 60_000 }, () => {
  let run: Harness
  let parent: string
  let folder: string

  beforeEach(() => {
    run = new Harness()
    parent = mkdtempSync(join(tmpdir(), 'even-keel-plain-'))
    folder = join(parent, 'notes')
    Object.assign(run.project, { git: false, repo: folder })
  })

  afterEach(async () => {
    await run.stop()
    rmSync(parent, { recursive: true, force: true })
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')

  it('switches git on for an existing repository, persists it over a restart and launches in a worktree', async () => {
    Object.assign(run.project, { repo: run.repo, slot: 3 })
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ noChanges: 'checked the worktree' }))
    await run.start()
    await run.post('project/git', { project: PROJECT_ID, on: true, slot: 0 })
    expect(run.service.configStore.view().projects[PROJECT_ID]).toMatchObject({ git: true, slot: 0 })
    await run.post('project/git', { project: PROJECT_ID, on: true, slot: 0 })
    await run.restart()
    expect(run.service.configStore.view().projects[PROJECT_ID]).toMatchObject({ git: true, slot: 0 })
    await run.startChain(PROJECT_ID)
    await run.until(() => run.board.status('ABC-1') === 'Done', 'worktree task done')
    expect(launches()[0]!.cwd).not.toBe(run.repo)
    expect(launches()[0]!.cwd).toContain('worktrees')
  })

  it('refuses to turn git off and changes nothing', async () => {
    // The harness's own git project, as the other files have it.
    for (const key of ['git', 'repo']) delete run.project[key]
    await run.start()
    const before = run.service.configStore.view().projects[PROJECT_ID]
    const refusal = await run.refused('project/git', { project: PROJECT_ID, on: false, force: true })
    expect(refusal.code).toBe('project.gitStaysOn')
    expect(run.service.configStore.view().projects[PROJECT_ID]).toEqual(before)
    expect(existsSync(join(run.repo, '.git'))).toBe(true)
  })

  it('initializes a plain folder and saves the chosen slots', async () => {
    await run.start(() => {
      mkdirSync(folder)
      // The first commit needs an identity, and a CI runner has none in its global config; the harness restores the variable.
      const config = join(parent, '.gitconfig')
      writeFileSync(config, '[user]\n\tname = John Doe\n\temail = john@example.com\n')
      process.env.GIT_CONFIG_GLOBAL = config
    })
    await run.post('project/git', { project: PROJECT_ID, on: true, slot: 2 })
    expect(run.service.configStore.view().projects[PROJECT_ID]).toMatchObject({ git: true, slot: 2 })
    expect(existsSync(join(folder, '.git'))).toBe(true)
  })

  it('runs its tasks one after another in the one folder and closes each by its mark with the answer as the comment', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', async () => ({ noChanges: 'the first answer' }))
    run.agent.script('ABC-2', async () => ({ noChanges: 'the second answer' }))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(run.board.commentsOf('ABC-1').join('\n')).toContain("The session's answer:\n\nthe first answer")
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(run.board.commentsOf('ABC-2').join('\n')).toContain('the second answer')

    expect(launches().map((call) => call.cwd)).toEqual([folder, folder])
    expect(existsSync(folder)).toBe(true)
    expect(readdirSync(folder)).not.toContain('.git')
    expect(existsSync(join(run.repo, '.claude', 'worktrees'))).toBe(false)
  })

  // BTN-962: the folder is every task's, so a skipped task's idle session would otherwise work beside the next one.
  it("stops a skipped task's idle session in the folder before the next task starts there", async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    run.agent.script('ABC-1', ends({ say: 'Not sure which source to trust; the notes are in the last message.' }))
    run.agent.script('ABC-2', ends({ noChanges: 'the second answer' }))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.state === 'done', 'the turn of ABC-1 ended')
    const [first] = launches()
    // The monitor has read the resting session, as it has long before a person presses Skip.
    await run.pass(10_000)

    await run.post('chain/skip', { project: PROJECT_ID, task: 'ABC-1' })
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')

    const calls = run.agent.calls
    const stopped = calls.findIndex((call) => call.kind === 'stop' && call.sessionId === first!.sessionId)
    const second = calls.findIndex((call) => call.kind === 'launch' && call.task === 'ABC-2')
    expect(stopped).toBeGreaterThanOrEqual(0)
    expect(stopped).toBeLessThan(second)
    expect(launches().map((call) => call.cwd)).toEqual([folder, folder])
    expect(run.board.status('ABC-1')).toBe('Todo')
  })

  // BTN-1044: only the dispatcher closes a task here, so "Stop after the turn" must not skip the mark.
  describe('asked to stop after the turn', () => {
    const stopAfter = () => run.post('chain/stopAfter', { project: PROJECT_ID, on: true })
    const stopped = () => run.service.dispatcher.state.active.length === 0

    beforeEach(() => {
      run.board.add('ABC-1')
      run.board.add('ABC-2', 'ABC-1')
      run.agent.script('ABC-2', ends({ noChanges: 'the second answer' }))
    })

    it('closes the task by the mark its turn ends with and does not start the next one', async () => {
      const gate = new Gate()
      run.agent.script('ABC-1', parked(gate, ends({ noChanges: 'the first answer' })))
      await run.start()
      await run.startChain(PROJECT_ID)
      await run.until(() => run.service.agentStatus('ABC-1') === 'busy', 'the session of ABC-1 seen working')

      await stopAfter()
      expect(stopped()).toBe(false)
      gate.open()
      await run.until(stopped, 'the chain stopped')

      expect(run.board.status('ABC-1')).toBe('Done')
      expect(run.board.commentsOf('ABC-1').join('\n')).toContain('the first answer')
      await run.pass(30_000)
      expect(launches().map((call) => call.task)).toEqual(['ABC-1'])
      expect(run.board.status('ABC-2')).toBe('Todo')
    })

    it('waits for the turn of a session it has just launched, before the monitor sees it working', async () => {
      const gate = new Gate()
      run.agent.script('ABC-1', parked(gate, ends({ noChanges: 'the first answer' })))
      await run.start()
      await run.startChain(PROJECT_ID)
      await run.until(() => launches().length === 1, 'ABC-1 launched', { step: 100 })

      await stopAfter()
      expect(run.service.dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, stopAfter: true })
      // Longer than the minute a session may go unseen: by then the monitor shows the turn itself.
      await run.pass(90_000)
      expect(stopped()).toBe(false)
      gate.open()
      await run.until(stopped, 'the chain stopped')

      expect(run.board.status('ABC-1')).toBe('Done')
      expect(launches().map((call) => call.task)).toEqual(['ABC-1'])
    })

    it('closes a task on the next start by the mark of its finished session, with no new session', async () => {
      run.agent.script('ABC-1', ends({ noChanges: 'the first answer' }))
      await run.start()
      await run.startChain(PROJECT_ID)
      await run.until(() => launches().length === 1, 'ABC-1 launched', { step: 100 })
      // "Stop": the session is not waited for and its mark is not read until the chain runs again.
      await run.post('chain/stop', { project: PROJECT_ID })
      await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.state === 'done', 'the turn of ABC-1 ended')
      await run.pass(10_000)
      expect(run.board.status('ABC-1')).not.toBe('Done')
      run.agent.leaves(launches()[0]!.sessionId)
      await run.pass(10_000)

      await run.startChain(PROJECT_ID)
      await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
      expect(run.board.status('ABC-1')).toBe('Done')
      expect(run.board.commentsOf('ABC-1').join('\n')).toContain('the first answer')
      expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    })

    it('closes it the same way after a restart of the service', async () => {
      run.agent.script('ABC-1', ends({ noChanges: 'the first answer' }))
      await run.start()
      await run.startChain(PROJECT_ID)
      await run.until(() => launches().length === 1, 'ABC-1 launched', { step: 100 })
      await run.post('chain/stop', { project: PROJECT_ID })
      await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.state === 'done', 'the turn of ABC-1 ended')
      run.agent.leaves(launches()[0]!.sessionId)
      await run.restart()

      await run.startChain(PROJECT_ID)
      await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
      expect(run.board.status('ABC-1')).toBe('Done')
      expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    })
  })
})
