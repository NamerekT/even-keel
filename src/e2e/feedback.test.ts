import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import { SESSION_MARK } from '../review/model.js'
import { ends, forReview, Gate, parked, type Turn } from './agent.fixture.js'
import { OWNER } from './forge.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('PR mode end to end: feedback', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.forge = true
    run.project.pullRequests = true
    run.pulls.access.set('jane', 'write')
    run.pulls.access.set('rick', 'read')
  })

  afterEach(async () => {
    await run.stop()
  })

  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)
  const calls = (kind: 'launch' | 'resume' | 'stop', task?: string) => run.agent.calls.filter((call) => call.kind === kind && (task === undefined || call.task === task))
  const headSubject = () => run.gitIn(run.remote, 'log', '-1', '--format=%s', 'abc-1/task')
  const record = () => run.service.dispatcher.state.reviews[PROJECT_ID]?.find((pull) => pull.task === 'ABC-1')

  /** ABC-1 plays `turns` after its first, which opens the pull request; returns once it is open and the session rests. */
  async function opened(...turns: Turn[]): Promise<number> {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'), ...turns)
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.pulls.of('ABC-1') !== undefined && record() !== undefined, 'the pull request of ABC-1 opened')
    return run.pulls.of('ABC-1')!.number
  }

  it('brings remarks and a red run of the head to the session by resume, and its fixes go to the same pull request', async () => {
    run.ci.outcome = (subject) => (subject.includes('Fix review') ? 'failure' : 'success')
    const pull = await opened(forReview('one.txt', 'fixed\n', 'Fix review'), forReview('one.txt', 'green\n', 'Fix CI'))

    run.pulls.review(pull, 'jane', 'REQUEST_CHANGES', 'Please rename it', [{ path: 'one.txt', position: 1, body: 'Use a better name' }])
    run.pulls.comment(pull, OWNER, 'And add a line to the README')
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the remarks delivered')
    const remarks = calls('resume', 'ABC-1')[0]!.prompt
    for (const text of ['Please rename it', 'one.txt:1:', 'Use a better name', 'And add a line to the README']) expect(remarks).toContain(text)

    await run.until(() => headSubject() === '[ABC-1] Fix review', 'the fix of the review pushed')
    await run.until(() => calls('resume', 'ABC-1').length === 2, 'the red run delivered')
    expect(calls('resume', 'ABC-1')[1]!.prompt).toContain('AssertionError: expected 3 to be 4')
    expect(calls('resume', 'ABC-1')[1]!.prompt).not.toContain('Please rename it')

    await run.until(() => headSubject() === '[ABC-1] Fix CI', 'the fix of the run pushed')
    await run.pass(180_000)
    expect(run.pulls.pulls).toHaveLength(1)
    expect(run.pulls.creates).toBe(1)
    expect(calls('launch', 'ABC-1')).toHaveLength(1)
    expect(calls('resume', 'ABC-1')).toHaveLength(2)
  })

  it('counts remarks by the author’s access and leaves out the session’s own marked words', async () => {
    const pull = await opened(ends({ say: 'Renamed' }))

    run.pulls.comment(pull, 'rick', 'An outsider asks for a rewrite')
    run.pulls.comment(pull, OWNER, `Pushed the rename. ${SESSION_MARK}`)
    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the remark delivered')
    const prompt = calls('resume', 'ABC-1')[0]!.prompt
    expect(prompt).toContain('Rename it, please')
    expect(prompt).not.toContain('An outsider asks for a rewrite')
    expect(prompt).not.toContain('Pushed the rename.')

    await run.pass(180_000)
    expect(calls('resume', 'ABC-1')).toHaveLength(1)
    const skipped = run.log.filter((line) => line.includes('of rick is skipped: its author has no write access to john/example'))
    expect(skipped).toHaveLength(1)
  })

  it('brings a conflict with main to the session once, and not again after it merges main', async () => {
    const resolve: Turn = async (turn) => {
      await turn.git('fetch', 'origin', 'main')
      await runGit(turn.cwd, ['merge', '--no-edit', 'origin/main'])
      await writeFile(join(turn.cwd, 'one.txt'), 'resolved\n')
      await turn.git('add', 'one.txt')
      await turn.git('commit', '--no-edit')
      return forReview(null)(turn)
    }
    await opened(resolve)

    await writeFile(join(run.repo, 'one.txt'), 'main\n')
    run.git('add', 'one.txt')
    run.git('commit', '-q', '-m', 'Main changes the same file')
    run.git('push', '-q', 'origin', 'main')
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the conflict delivered')
    expect(calls('resume', 'ABC-1')[0]!.prompt).toContain('The pull request conflicts with main')

    await run.until(() => run.gitIn(run.remote, 'log', '-1', '--format=%P', 'abc-1/task').split(' ').length === 2, 'the merge of main pushed')
    await run.pass(300_000)
    expect(calls('resume', 'ABC-1')).toHaveLength(1)
    expect(record()!.seen.filter((key) => key.startsWith('conflict:'))).toHaveLength(1)
  })

  it('hands a remark that comes once the session cache went cold to a new session', async () => {
    const pull = await opened(forReview('one.txt', 'fixed\n', 'Fix review'))

    // Past `WARM_CACHE_MS`; nothing happens meanwhile, so the steps are long.
    await run.pass(60 * 60_000, 5 * 60_000)
    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.until(() => calls('launch', 'ABC-1').length === 2, 'a new session launched with the remark')
    expect(calls('launch', 'ABC-1')[1]!.prompt).toContain('Rename it, please')
    expect(calls('resume', 'ABC-1')).toEqual([])
    await run.until(() => headSubject() === '[ABC-1] Fix review', 'the fix pushed by the new session')
    expect(run.pulls.pulls).toHaveLength(1)
  })

  it('starts a chain that ended by itself again on a remark on its pull request', async () => {
    const pull = await opened(ends({ say: 'Renamed' }))
    await run.until(() => chain() === undefined, 'the chain ended with no task left')

    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the remark delivered')
    expect(run.log.some((line) => line.includes('starts again: feedback came on a pull request of its tasks'))).toBe(true)
  })

  it('leaves a chain the user stopped stopped on a remark, and Start takes the remark as work', async () => {
    const gate = new Gate()
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    run.agent.script('ABC-1', forReview('one.txt'), ends({ say: 'Renamed' }))
    run.agent.script('ABC-2', parked(gate, ends({ say: 'Done' })))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.pulls.of('ABC-1') !== undefined && calls('launch', 'ABC-2').length === 1, 'ABC-1 out for review, ABC-2 launched')
    const pull = run.pulls.of('ABC-1')!.number

    await run.post('chain/stop', { project: PROJECT_ID })
    gate.open()
    await run.pass(60_000)
    run.pulls.comment(pull, 'jane', 'Rename it, please')
    await run.pass(180_000)
    expect(calls('resume', 'ABC-1')).toEqual([])
    expect(chain()).toBeUndefined()

    await run.startChain(PROJECT_ID)
    await run.until(() => calls('resume', 'ABC-1').length === 1, 'the remark delivered after Start')
    expect(calls('resume', 'ABC-1')[0]!.prompt).toContain('Rename it, please')
  })
})

describe('PR mode end to end: feedback on GitHub', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.githubRemote = true
    run.project.pullRequests = true
    run.githubPulls.access.set('jane', 'write')
    run.githubPulls.bots.add('github-actions[bot]')
  })

  afterEach(async () => {
    await run.stop()
  })

  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume' && call.task === 'ABC-1')

  it('leaves a bot’s comment out with no log line, an outsider’s out with one, and brings a collaborator’s', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', forReview('one.txt'), ends({ say: 'Renamed' }))
    await run.start()
    await run.startChain(PROJECT_ID)
    const record = () => run.service.dispatcher.state.reviews[PROJECT_ID]?.find((pull) => pull.task === 'ABC-1')
    await run.until(() => run.githubPulls.of('ABC-1') !== undefined && record() !== undefined, 'the pull request of ABC-1 opened on GitHub')
    const pull = run.githubPulls.of('ABC-1')!.number
    expect(record()!.url).toBe(`https://github.com/${OWNER}/example/pull/${pull}`)

    run.githubPulls.comment(pull, 'github-actions[bot]', 'Coverage went down by 0.1%')
    run.githubPulls.comment(pull, 'rick', 'An outsider asks for a rewrite')
    run.githubPulls.comment(pull, 'jane', 'Rename it, please')
    await run.until(() => resumes().length === 1, 'the remark delivered')
    const prompt = resumes()[0]!.prompt
    expect(prompt).toContain('Rename it, please')
    expect(prompt).not.toContain('Coverage went down')
    expect(prompt).not.toContain('An outsider asks for a rewrite')

    await run.pass(180_000)
    expect(resumes()).toHaveLength(1)
    expect(run.log.filter((line) => line.includes('github-actions[bot]'))).toEqual([])
    expect(run.log.filter((line) => line.includes('of rick is skipped: its author is not a collaborator of john/example'))).toHaveLength(1)
  })
})
