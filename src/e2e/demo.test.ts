import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinStore, type BuiltinTask } from '../builtin/store.js'
import { Harness } from './service.fixture.js'

describe('the demo on the first run end to end', { timeout: 240_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
    run.realAgents = ['demo']
    tasks = []
  })

  afterEach(async () => {
    await run.stop()
  })

  const demo = () => run.service.demo
  const project = () => demo().project()!
  let tasks: BuiltinTask[] = []
  const read = () => void new BuiltinStore(run.service.db).list([project()]).then((list) => (tasks = list))
  const statusOf = (number: number) => {
    read()
    return tasks.find((task) => task.number === number)?.status.name
  }
  const sessionOf = (task: string) => run.service.sessions.find((view) => view.task === task && view.lamp !== 'finished')

  it('runs from the button to the end card, through a restart and an answer from the chat, and goes without a trace', async () => {
    await run.start()
    await run.post('demo/start', {})
    const id = project()
    expect(run.service.configStore.current.keys[id]).toBe('DEMO')
    expect(run.service.configStore.current.settings[id]!.testProject).toBe(true)
    expect(run.service.getState().demo).toEqual({ project: id, finished: false })
    // No account of the person's is listed for it: the demo's own is not on the page.
    expect(run.service.getState().account.accounts.map((entry) => entry.key)).not.toContain('even-keel-demo')

    await run.until(() => statusOf(1) === 'Done', 'DEMO-1 done')
    await run.until(() => sessionOf('DEMO-2')?.lamp === 'working', 'DEMO-2 at work')
    await run.restart()
    await run.until(() => statusOf(2) === 'Done', 'DEMO-2 done after the restart')

    await run.until(() => sessionOf('DEMO-3')?.ask != null, 'the question of DEMO-3')
    const asking = sessionOf('DEMO-3')!
    const question = asking.ask!.questions[0]!
    expect(question.options.map((option) => option.label)).toEqual(['Friendly', 'Formal'])
    await run.post('session/answer', { project: id, task: 'DEMO-3', sessionId: asking.sessionId, ask: asking.ask!.id, answers: { [question.question]: 'Formal' }, text: '' })

    await run.until(() => run.service.getState().demo?.finished === true, 'the demo finished')
    // One session a task: the one found mid-turn after the restart went on, it was not launched again.
    expect(run.service.launches.filter((entry) => entry.project === id && entry.reason === undefined).map((entry) => entry.task)).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-3'])
    const repo = demo().repo
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('Welcome aboard')
    expect(existsSync(join(repo, 'CHANGELOG.md'))).toBe(true)
    expect(readFileSync(join(repo, 'GREETING.md'), 'utf8')).toContain('Good day')
    expect(run.gitIn(repo, 'log', '--format=%s').split('\n')).toEqual(expect.arrayContaining(['[DEMO-1] README.md', '[DEMO-2] CHANGELOG.md', '[DEMO-3] GREETING.md']))

    await run.post('demo/remove', {})
    expect(run.service.getState().demo).toBeNull()
    expect(run.service.configStore.current.projects[id]).toBeUndefined()
    expect(existsSync(demo().dir)).toBe(false)
    expect(await new BuiltinStore(run.service.db).list([id])).toEqual([])
    expect(run.service.launches.filter((entry) => entry.project === id)).toEqual([])
  })

  it('removed mid-turn, lets its session go and starts again from scratch', async () => {
    await run.start()
    await run.post('demo/start', {})
    const first = project()
    await run.until(() => sessionOf('DEMO-1')?.lamp === 'working', 'DEMO-1 at work')
    await run.post('demo/remove', {})
    expect(existsSync(demo().dir)).toBe(false)
    expect(run.service.configStore.current.projects[first]).toBeUndefined()
    await run.pass(30_000)
    expect(existsSync(demo().dir)).toBe(false)

    // Started again in the page's other language: the tasks and the agent's work take it, whatever the settings say.
    await run.post('demo/again', { language: 'ru' })
    expect(project()).not.toBe(first)
    tasks = []
    await run.until(() => statusOf(1) === 'Done', 'DEMO-1 of the new demo done')
    const made = await new BuiltinStore(run.service.db).list([project()])
    expect(made.map((task) => task.number).sort()).toEqual([1, 2, 3])
    expect(made.find((task) => task.number === 1)!.title).toBe('Добавить приветствие в README')
    expect(run.gitIn(demo().repo, 'show', 'HEAD:README.md')).toContain('Добро пожаловать на борт')
  })

  it('refuses without git without leaving a folder and can be retried', async () => {
    await run.start()
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      const notice = await run.refused('demo/start', {})
      expect(notice.code).toBe('demo.noGit')
    } finally {
      process.env.PATH = path
    }
    expect(run.service.getState().demo).toBeNull()
    expect(existsSync(demo().dir)).toBe(false)
    await run.post('demo/start', {})
    expect(run.service.getState().demo?.project).toBe(project())
    expect(existsSync(demo().repo)).toBe(true)
  })
})
