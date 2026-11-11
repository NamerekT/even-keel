import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

// The scripted agent hands the shell an empty environment: on macOS /bin/sh then finds no `node` on its default PATH.
const nodeCommand = (script: string) => [process.execPath, script].map((path) => `"${path.replaceAll('\\', '/')}"`).join(' ')

/** A merge after the check hook passed: the report goes to the service before the merge, as the hook sends it. */
const reportedMerge =
  (file: string): Turn =>
  async (turn) => {
    const merge = commitAndMerge(file)
    const hooked: Parameters<Turn>[0] = {
      ...turn,
      git: async (...args) => {
        const out = await turn.git(...args)
        if (args[0] === 'commit') await turn.reportCheck()
        return out
      },
    }
    return merge(hooked)
  }

describe('the check of main without a CI end to end (EKR-103)', { timeout: 60_000 }, () => {
  let run: Harness
  let marks: string

  beforeEach(async () => {
    run = new Harness()
    const script = join(run.dir, 'check.js')
    marks = join(run.dir, 'check.log')
    await writeFile(script, `require('fs').appendFileSync(${JSON.stringify(marks)}, process.cwd() + '\\n')\n`)
    // With the check of main off a push the check before the merge did not report is still checked.
    run.project.commands = { check: [nodeCommand(script)] }
    run.project.ci = { recheckMain: false }
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
  })

  afterEach(async () => {
    await run.stop()
  })

  const runs = () => (existsSync(marks) ? readFileSync(marks, 'utf8').split('\n').filter(Boolean) : [])
  const launched = () => run.agent.calls.filter((call) => call.kind === 'launch').map((call) => call.task)
  // ABC-2 works on without merging: a merge of its own would move main past the push the asserts name.
  const working = (): Turn => parked(new Gate(), commitAndMerge('two.txt'))

  it('checks main in the next task place before its launch when the session merged without the check hook', async () => {
    run.agent.script('ABC-1', commitAndMerge('one.txt'))
    run.agent.script('ABC-2', working())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => launched().includes('ABC-2'), 'ABC-2 launched')
    const main = run.gitIn(run.repo, 'rev-parse', '--short=7', 'main')
    expect(run.log).toContain(`ci: ABC: ${main} is checked in the next task's place before it starts: the check before the merge did not report`)
    expect(run.log).toContain(`ci: ABC: ${main} passed the check in the place of ABC-2`)
    expect(runs()).toHaveLength(1)
    expect(runs()[0]!.toLowerCase()).toContain('abc-2')
  })

  it('counts main green by the report of the check before the merge, and runs nothing more', async () => {
    run.agent.script('ABC-1', reportedMerge('one.txt'))
    run.agent.script('ABC-2', working())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => launched().includes('ABC-2'), 'ABC-2 launched')
    const main = run.gitIn(run.repo, 'rev-parse', '--short=7', 'main')
    expect(run.log).toContain(`ci: ABC: ${main} is the tree the check before the merge reported`)
    expect(runs()).toEqual([])
  })
})
