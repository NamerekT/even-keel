import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkpoint, commitAndMerge, Gate, parked } from './agent.fixture.js'
import { CODEX_ACCOUNT, Harness, PROJECT_ID } from './service.fixture.js'
import { BACKLOG } from './tracker.fixture.js'

describe('the labels of a task', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const chain = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)
  const listed = (task: string) => run.service.knownTask(task)

  it('starts a task on its run label, as the project says on two of them and once the label is gone', async () => {
    run.codex = true
    Object.assign(run.project, { modelLabels: true, models: { claude: 'sonnet' }, accounts: { codex: CODEX_ACCOUNT } })
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.board.add('ABC-3', 'ABC-2')
    run.board.add('ABC-4', 'ABC-3')
    run.board.label('ABC-1', 'Claude | haiku')
    run.board.label('ABC-2', 'Codex | gpt-6.1-sol')
    run.board.label('ABC-3', 'Claude | haiku', 'Codex')
    run.board.label('ABC-4', 'Claude | haiku')
    const unlabeled = new Gate()
    for (const task of ['ABC-1', 'ABC-2', 'ABC-3']) run.agent.script(task, commitAndMerge(`${task}.txt`))
    run.agent.script('ABC-4', parked(unlabeled, checkpoint('.temp/handoff.md', 'Half of it is done.\n')), commitAndMerge('ABC-4.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => launches().length === 4, 'ABC-4 launched')
    run.board.label('ABC-4')
    await run.until(() => listed('ABC-4')?.labels.length === 0, 'the label of ABC-4 read')
    unlabeled.open()
    await run.until(() => run.board.status('ABC-4') === 'Done', 'ABC-4 done')

    expect(launches().map(({ task, provider, model }) => ({ task, provider, model }))).toEqual([
      { task: 'ABC-1', provider: 'claude', model: 'haiku' },
      { task: 'ABC-2', provider: 'codex', model: 'gpt-6.1-sol' },
      { task: 'ABC-3', provider: 'claude', model: 'sonnet' },
      { task: 'ABC-4', provider: 'claude', model: 'haiku' },
      { task: 'ABC-4', provider: 'claude', model: 'sonnet' },
    ])
    expect(run.log.some((line) => line.includes('ABC-3 carries run labels'))).toBe(true)
  })

  it('pauses before a launch on a model the account lacks and goes on by itself once the project names one it has', async () => {
    run.agent.modelList = ['sonnet', 'opus']
    run.project.models = { claude: 'sonet' }
    run.board.add('ABC-1')
    run.agent.script('ABC-1', commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.pass(60_000)
    expect(chain()).toMatchObject({ paused: true, error: { code: 'chain.unknownModel', params: expect.objectContaining({ task: 'ABC-1', model: 'sonet' }) } })
    expect(launches()).toEqual([])

    const form = run.service.configStore.view().projects[PROJECT_ID]!
    run.service.configStore.saveProject(PROJECT_ID, { ...form, models: { claude: 'sonnet' } }, form)
    await run.until(() => launches().length === 1, 'ABC-1 launched', { limitMs: 60_000 })
    expect(launches()[0]).toMatchObject({ model: 'sonnet' })
    expect(chain()).toMatchObject({ paused: false, error: null })
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('keeps a task without the required label out of the chain until the page puts it on, and back out once it is taken off', async () => {
    run.project.chain = { requiredLabels: ['agent'] }
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    run.board.add('ABC-3')
    run.board.label('ABC-1', 'agent')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-3', commitAndMerge('ABC-3.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.service.sessions.some((view) => view.task === 'ABC-1'), 'the session of ABC-1 seen')

    const refusal = await run.refused('task/unready', { task: 'ABC-1' })
    expect(refusal).toMatchObject({ code: 'task.unreadyLive', params: { task: 'ABC-1' } })
    expect(run.board.labels('ABC-1')).toEqual(['agent'])

    await run.post('task/ready', { task: 'ABC-2' })
    expect(run.board.labels('ABC-2')).toEqual(['agent'])
    await run.post('task/unready', { task: 'ABC-2' })
    expect(run.board.labels('ABC-2')).toEqual([])
    expect(run.board.status('ABC-2')).toBe('Backlog')
    await run.post('task/ready', { task: 'ABC-3' })
    expect(run.board.labels('ABC-3')).toEqual(['agent'])

    gate.open()
    await run.until(() => run.board.status('ABC-3') === 'Done', 'ABC-3 done')
    await run.pass(60_000)
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-3'])
  })

  it('puts the labels the page sets into the service at once and leaves all as it was when the tracker refuses', async () => {
    run.board.add('ABC-1')
    run.board.move('ABC-1', BACKLOG)
    run.board.label('ABC-1', 'ui')
    await run.start()

    await run.post('task/labels', { task: 'ABC-1', add: ['docs'], remove: ['ui'] })
    expect(run.board.labels('ABC-1')).toEqual(['docs'])
    expect(listed('ABC-1')?.labels).toEqual(['docs'])

    run.board.refuseRelabel = 'Forbidden'
    const refusal = await run.refused('task/labels', { task: 'ABC-1', add: ['ui'], remove: [] })
    expect(refusal).toMatchObject({ code: 'task.relabelFailed', params: { task: 'ABC-1' } })
    expect(run.board.labels('ABC-1')).toEqual(['docs'])
    expect(listed('ABC-1')?.labels).toEqual(['docs'])
  })
})
