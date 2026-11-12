import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ends } from './agent.fixture.js'
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
})
