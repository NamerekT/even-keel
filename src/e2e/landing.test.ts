import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'
import { scaled } from '../../test/slow-runner.js'
import { chainBlocks } from '../../web/src/state.js'

const nodeCommand = (script: string) => [process.execPath, script].map((path) => `"${path.replaceAll('\\', '/')}"`).join(' ')
const IDENTITY = ['-c', 'user.name=John Doe', '-c', 'user.email=john@example.com']

describe('the landing of a merge into the remote main end to end (BTN-1581)', { timeout: scaled(120_000) }, () => {
  let run: Harness
  let pushes = 0

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    pushes = 0
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-2', commitAndMerge('two.txt'))
  })

  afterEach(async () => {
    await run.stop()
  })

  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)
  const landing = () => run.service.dispatcher.state.landings[PROJECT_ID]?.find((each) => each.task === 'ABC-1')
  const calls = (kind: 'launch' | 'resume', task: string) => run.agent.calls.filter((call) => call.kind === kind && call.task === task)
  const remoteLog = () => run.gitIn(run.remote, 'log', '--format=%s', 'main').split('\n')
  const localLog = () => run.gitIn(run.repo, 'log', '--format=%s', 'main').split('\n')

  /** Another clone of the remote pushes `file` with `text` to its main: work that landed meanwhile. */
  async function pushedElsewhere(file: string, text: string): Promise<void> {
    const other = join(run.dir, `other-${++pushes}`)
    run.gitIn(run.dir, 'clone', '-q', '-c', 'core.autocrlf=false', run.remote, other)
    await writeFile(join(other, file), text)
    run.gitIn(other, 'add', file)
    run.gitIn(other, ...IDENTITY, 'commit', '-q', '-m', `Elsewhere ${pushes}`)
    run.gitIn(other, 'push', '-q', 'origin', 'main')
  }

  /** Writes `text` to `file` on the task's branch and merges it into main, the remote's main left out. */
  const mergeWith = (file: string, text: string, before?: () => Promise<void>): Turn => async ({ task, cwd, repo, git }) => {
    await before?.()
    await writeFile(join(cwd, file), text)
    await git('add', file)
    await git('commit', '-m', `[${task}] Work`)
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
    run.gitIn(repo, 'merge', '--no-edit', branch)
    return { say: `${task} merged` }
  }

  it('returns a conflict to the session with main rolled back, and lands and closes the task after its new merge', async () => {
    const seen: { prompt: string; local: string[]; status: string | undefined }[] = []
    run.agent.script(
      'ABC-1',
      mergeWith('shared.txt', 'ABC-1\n', () => pushedElsewhere('shared.txt', 'elsewhere\n')),
      async ({ task, cwd, repo, git, prompt }) => {
        seen.push({ prompt, local: localLog(), status: run.board.status(task) })
        const merged = await git('merge', '--no-edit', 'origin/main').catch(() => 'conflict')
        expect(merged).toBe('conflict')
        await writeFile(join(cwd, 'shared.txt'), 'ABC-1\nelsewhere\n')
        await git('add', 'shared.txt')
        await git('commit', '--no-edit')
        run.gitIn(repo, 'merge', '--no-edit', await git('rev-parse', '--abbrev-ref', 'HEAD'))
        return { say: `${task} merged again` }
      },
    )
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done after its second merge')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.prompt).toContain('shared.txt')
    expect(seen[0]!.local).not.toContain('[ABC-1] Work')
    expect(seen[0]!.status).not.toBe('Done')
    expect(calls('resume', 'ABC-1')).toHaveLength(1)
    expect(remoteLog()).toEqual(expect.arrayContaining(['[ABC-1] Work', 'Elsewhere 1']))
    await run.until(() => calls('launch', 'ABC-2').length === 1, 'ABC-2 launched')
    expect(landing()).toBeUndefined()
  })

  it('pauses with the question once a fourth round would be needed, telling the session nothing more', async () => {
    const rounds = [1, 2, 3, 4].map((round) => mergeWith('shared.txt', `ABC-1 round ${round}\n`, round === 1 ? () => pushedElsewhere('shared.txt', 'elsewhere\n') : undefined))
    run.agent.script('ABC-1', ...rounds)
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => chain()?.error?.code === 'landing.exhausted', 'the chain paused on landing.exhausted')
    expect(chain()).toMatchObject({ paused: true, current: { task: 'ABC-1' } })
    expect(calls('resume', 'ABC-1')).toHaveLength(3)
    expect(landing()).toMatchObject({ rounds: 3, resolving: true })
    await run.pass(60_000)
    expect(calls('resume', 'ABC-1')).toHaveLength(3)
    expect(calls('launch', 'ABC-1')).toHaveLength(1)
    expect(run.board.status('ABC-1')).not.toBe('Done')
    expect(localLog()).not.toContain('[ABC-1] Work')
    expect(remoteLog()).not.toContain('[ABC-1] Work')
  })

  it('returns a red commands.check on a clean merge with the remote to the session, not to a banner', async () => {
    const script = join(run.dir, 'check.js')
    await writeFile(
      script,
      "const fs = require('fs')\nif (fs.existsSync('elsewhere.txt') && !fs.existsSync('fixed.txt')) { console.log('FAIL elsewhere.txt needs fixed.txt'); process.exit(1) }\n",
    )
    run.project.commands = { check: [nodeCommand(script)] }
    let prompt = ''
    run.agent.script('ABC-1', mergeWith('one.txt', 'ABC-1\n', () => pushedElsewhere('elsewhere.txt', 'elsewhere\n')), async (turn) => {
      prompt = turn.prompt
      await turn.git('merge', '--no-edit', 'origin/main')
      return mergeWith('fixed.txt', 'fixed\n')(turn)
    })
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done after the fix')
    expect(prompt).toContain('FAIL elsewhere.txt needs fixed.txt')
    expect(calls('resume', 'ABC-1')).toHaveLength(1)
    expect(remoteLog()).toEqual(expect.arrayContaining(['[ABC-1] Work', 'Elsewhere 1']))
    expect(run.service.dispatcher.state.leftovers[PROJECT_ID] ?? []).toEqual([])
  })

  it('shows the merged task at work, not waiting for an answer, while a long commands.check holds its landing (BTN-1779)', async () => {
    const gate = join(run.dir, 'gate.txt')
    const script = join(run.dir, 'check.js')
    await writeFile(
      script,
      `const fs = require('fs')\nconst end = Date.now() + 60000\nconst wait = () => fs.existsSync(${JSON.stringify(gate)}) || Date.now() > end ? process.exit(0) : setTimeout(wait, 50)\nwait()\n`,
    )
    run.project.commands = { check: [nodeCommand(script)] }
    // The check runs only on a merge with a remote main that moved meanwhile.
    run.agent.script('ABC-1', mergeWith('one.txt', 'ABC-1\n', () => pushedElsewhere('elsewhere.txt', 'elsewhere\n')))
    await run.start()
    await run.startChain(PROJECT_ID)

    const row = () => chainBlocks(run.service.getState(), PROJECT_ID).find((block) => block.id === 'ABC-1')
    const session = () => run.service.getState().sessions.find((each) => each.task === 'ABC-1')
    // A step waits up to 10 s of real time for the running check; a long one passes the landing's wait at once.
    await run.until(() => session()?.lamp === 'waiting' && row()?.landing === true, 'ABC-1 ended its turn with the landing underway', { step: 5_000 })
    expect(row()?.lamp).toBe('working')
    expect(run.board.status('ABC-1')).not.toBe('Done')

    await writeFile(gate, 'go\n')
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done once the check passes')
    await run.until(() => calls('launch', 'ABC-2').length === 1, 'ABC-2 launched')
    // ABC-2's own merge may already be landing on a slow runner: only ABC-1's facts must be gone.
    expect((run.service.dispatcher.landingFacts()[PROJECT_ID] ?? []).filter((each) => each.task === 'ABC-1')).toEqual([])
  })

  it('keeps the task open while the remote is out of reach, telling the session nothing, and lands it once it is back', async () => {
    let lead: [string, string] = ['', '']
    run.agent.script('ABC-1', async (turn) => {
      const end = await commitAndMerge('one.txt')(turn)
      // Without the lead to the bare repository the remote's address is a port where nothing listens.
      lead = run.gitIn(turn.repo, 'config', '--get-regexp', '^url\\.').split(' ') as [string, string]
      run.gitIn(turn.repo, 'config', '--unset', lead[0])
      return end
    })
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => landing()?.waitingRemote === true, 'the landing waiting for the remote', { step: 10_000 })
    expect(run.board.status('ABC-1')).not.toBe('Done')
    expect(calls('resume', 'ABC-1')).toEqual([])
    expect(chain()).toMatchObject({ paused: false, current: { task: 'ABC-1' } })

    run.gitIn(run.repo, 'config', ...lead)
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done once the remote is back', { step: 30_000, limitMs: 20 * 60_000 })
    expect(remoteLog()).toContain('[ABC-1] Work')
    expect(calls('resume', 'ABC-1')).toEqual([])
  })
})
