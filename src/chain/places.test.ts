import { describe, expect, it } from 'vitest'
import type { Git } from '../git/types.js'
import { TaskPlaces } from './places.js'

function setup(options: { behind?: string; failSetUp?: boolean } = {}) {
  const calls: string[] = []
  let failSetUp = options.failSetUp ?? false
  const git: Git = async (_cwd, args) => {
    const command = args.join(' ')
    if (command === 'rev-list --count HEAD..main') return { code: 0, out: options.behind ?? '0' }
    if (command.startsWith('rev-list')) return { code: 0, out: '0' }
    if (command.startsWith('merge')) calls.push('merge')
    return { code: 0, out: '' }
  }
  const places = new TaskPlaces({
    git,
    place: async (_project, task) => (calls.push(`place ${task}`), { path: `D:/w/${task}`, branch: `${task}/task` }),
    setUp: async (_project, task) => {
      calls.push(`setUp ${task}`)
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
    expect(calls).toEqual(['place ABC-2', 'setUp ABC-2'])
  })

  it('does not run the commands again for a place prepared ahead that main did not pass', async () => {
    const { places, calls } = setup()
    await places.prepare('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2', 'setUp ABC-2', 'place ABC-2'])
  })

  it('brings a place prepared ahead up to main and runs the commands again', async () => {
    const { places, calls } = setup({ behind: '1' })
    await places.prepare('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2', 'setUp ABC-2', 'place ABC-2', 'merge', 'setUp ABC-2'])
  })

  it('sets the place up again when its preparation ahead failed', async () => {
    const { places, calls } = setup({ failSetUp: true })
    await expect(places.prepare('ABC', 'ABC-2')).rejects.toThrow(/npm ci/)
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2', 'setUp ABC-2', 'place ABC-2', 'setUp ABC-2'])
  })

  it('keeps a place readied for the check of main as prepared for the launch that follows', async () => {
    const { places, calls } = setup()
    await places.readyAhead('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    await places.ready('ABC', 'ABC-2')
    expect(calls).toEqual(['place ABC-2', 'setUp ABC-2', 'place ABC-2', 'place ABC-2', 'setUp ABC-2'])
  })
})
