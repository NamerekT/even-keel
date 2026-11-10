import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
