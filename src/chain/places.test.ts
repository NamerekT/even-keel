import { describe, expect, it } from 'vitest'
import type { Git } from '../git/types.js'
import { TaskPlaces } from './places.js'

function setup(options: { behind?: string; failSetUp?: boolean; main?: string; movedAway?: boolean } = {}) {
  const calls: string[] = []
  let failSetUp = options.failSetUp ?? false
  const main = options.main ?? 'main'
  const git: Git = async (_cwd, args) => {
    const command = args.join(' ')
    if (command === `rev-list --count HEAD..${main}`) return { code: 0, out: options.behind ?? '0' }
    if (command.startsWith('rev-list')) return { code: 0, out: '0' }
    if (command.startsWith('merge')) calls.push(command)
    return { code: 0, out: '' }
  }
  const places = new TaskPlaces({
    git,
    main: () => main,
    place: async (_project, task, { ahead = false, at } = {}) => {
      calls.push(`place ${task}${ahead ? ' ahead' : ''}${at === undefined ? '' : ` at ${at}`}`)
      const path = options.movedAway && !ahead ? `D:/w2/${task}` : `D:/w/${task}`
      return { path, branch: ahead ? null : `${task}/task` }
    },
    setUp: async (_project, task, path) => {
      calls.push(`setUp ${task} in ${path}`)
      if (failSetUp) {
        failSetUp = false
        throw new Error('npm ci failed')
      }
    },
  })
  return { places, calls }
}

describe('TaskPlaces', () => {
  it('sets a place up at the launch when nothing was prepared ahead', async () => {
    const { places, calls } = setup()
    expect(await places.ready('ABC', 'ABC-2')).toEqual({ path: 'D:/w/ABC-2', branch: 'ABC-2/task' })
    expect(calls).toEqual(['place ABC-2', 'setUp ABC-2 in D:/w/ABC-2'])
  })

  it('prepares a place ahead without the task branch and makes it at the launch in the same place', async () => {
    const { places, calls } = setup()
    await places.prepare('ABC', 'ABC-2')
    expect(await places.ready('ABC', 'ABC-2')).toEqual({ path: 'D:/w/ABC-2', branch: 'ABC-2/task' })
    expect(calls).toEqual(['place ABC-2 ahead', 'setUp ABC-2 in D:/w/ABC-2', 'place ABC-2 at D:/w/ABC-2'])
  })

  it('brings a place prepared ahead up to main and runs the commands again', async () => {
    const { places, calls } = setup({ behind: '1' })
    await places.prepare('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual([
      'place ABC-2 ahead',
      'setUp ABC-2 in D:/w/ABC-2',
      'place ABC-2 at D:/w/ABC-2',
      'merge --ff-only main',
      'setUp ABC-2 in D:/w/ABC-2',
    ])
  })

  it('brings a place up to the project’s main branch when it is not main', async () => {
    const { places, calls } = setup({ behind: '1', main: 'master' })
    await places.prepare('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toContain('merge --ff-only master')
  })

  it('sets the place up again when its preparation ahead failed', async () => {
    const { places, calls } = setup({ failSetUp: true })
    await expect(places.prepare('ABC', 'ABC-2')).rejects.toThrow(/npm ci/)
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2 ahead', 'setUp ABC-2 in D:/w/ABC-2', 'place ABC-2', 'setUp ABC-2 in D:/w/ABC-2'])
  })

  it('sets up a place the launch took instead of the one prepared ahead', async () => {
    const { places, calls } = setup({ movedAway: true })
    await places.prepare('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2 ahead', 'setUp ABC-2 in D:/w/ABC-2', 'place ABC-2 at D:/w/ABC-2', 'setUp ABC-2 in D:/w2/ABC-2'])
  })

  it('keeps a place readied for the check of main without the task branch and as prepared for the launch that follows', async () => {
    const { places, calls } = setup()
    expect(await places.readyAhead('ABC', 'ABC-2')).toEqual({ path: 'D:/w/ABC-2', branch: null })
    await places.ready('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2 ahead', 'setUp ABC-2 in D:/w/ABC-2', 'place ABC-2 at D:/w/ABC-2', 'place ABC-2', 'setUp ABC-2 in D:/w/ABC-2'])
  })

  it('readies a place prepared ahead for the check of main without setting it up again', async () => {
    const { places, calls } = setup()
    await places.prepare('ABC', 'ABC-2')
    await places.readyAhead('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2 ahead', 'setUp ABC-2 in D:/w/ABC-2', 'place ABC-2 ahead at D:/w/ABC-2'])
  })
})
