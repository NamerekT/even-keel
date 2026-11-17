import { describe, expect, it } from 'vitest'
import type { GitResult } from '../git/types.js'
import { Assignments } from '../machine/assignments.js'
import { TaskMoves } from '../machine/task-moves.js'
import { NoticeError } from '../notice/notice.js'
import { Writes, type Db } from '../storage/database.js'
import { Reassigner } from './reassign.js'

const REPO = '/home/john/abc'
const ask = (branch: string) => `ls-remote --exit-code --heads origin refs/heads/${branch}`

async function rig(answers: Record<string, Partial<GitResult>> = {}) {
  const db = { query: async () => ({ rows: [] }) } as unknown as Db
  const writes = new Writes(() => {})
  const moves = await TaskMoves.open({ db, writes, now: () => 1_000 })
  const assignments = await Assignments.open({ db, writes, order: () => [], movedFrom: (project, task) => moves.from(project, task) })
  const calls: string[] = []
  const moved: string[] = []
  let changed = 0
  const connected = new Set(['desk'])
  const reassigner = new Reassigner({
    own: () => 'pc',
    assignments,
    moves,
    connected: (machine) => connected.has(machine),
    names: () => ({ pc: 'Workstation', laptop: 'Laptop', desk: 'Desk' }),
    repoOf: (project) => (project === 'p' ? REPO : undefined),
    moved: (project, task) => void moved.push(`${project}/${task}`),
    changed: () => void changed++,
    log: () => {},
    git: async (_cwd, args) => {
      const command = args.join(' ')
      calls.push(command)
      return { code: 0, out: command === 'remote' ? 'origin\n' : '', ...answers[command] }
    },
    now: () => 1_000,
  })
  return { reassigner, assignments, moves, calls, moved, changed: () => changed }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Reassigner', () => {
  it('lists the tasks of machines gone, never the own one or one connected, and asks the remote behind', async () => {
    const { reassigner, assignments, changed } = await rig({ [ask('abc-2/task')]: { code: 2 } })
    assignments.assign('p', 'ABC-1', 'laptop')
    assignments.assign('p', 'ABC-2', 'laptop')
    assignments.assign('p', 'ABC-3', 'pc')
    assignments.assign('p', 'ABC-4', 'desk')
    expect(reassigner.stranded()).toEqual({ p: { 'ABC-1': { machine: 'laptop', pushed: null }, 'ABC-2': { machine: 'laptop', pushed: null } } })
    await settle()
    expect(changed()).toBe(2)
    expect(reassigner.stranded()).toEqual({ p: { 'ABC-1': { machine: 'laptop', pushed: true }, 'ABC-2': { machine: 'laptop', pushed: false } } })
  })

  it('moves a pushed task off its machine gone: the row goes, the move is kept, the lane ends', async () => {
    const { reassigner, assignments, moves, moved } = await rig()
    assignments.assign('p', 'ABC-1', 'laptop')
    await reassigner.reassign('p', 'ABC-1')
    expect(assignments.machineOf('p', 'ABC-1')).toBeUndefined()
    expect(moves.of('p', 'ABC-1')).toEqual({ project: 'p', task: 'ABC-1', from: 'laptop', branch: 'abc-1/task', at: 1_000, launched: false })
    expect(moved).toEqual(['p/ABC-1'])
    expect(reassigner.stranded()).toEqual({})
  })

  it('refuses a task whose branch the remote lacks, or whose machine is connected', async () => {
    const { reassigner, assignments, moved } = await rig({ [ask('abc-1/task')]: { code: 2 } })
    assignments.assign('p', 'ABC-1', 'laptop')
    assignments.assign('p', 'ABC-2', 'desk')
    await expect(reassigner.reassign('p', 'ABC-1')).rejects.toSatisfy((error: NoticeError) => error.notice.code === 'reassign.notPushed')
    await expect(reassigner.reassign('p', 'ABC-2')).rejects.toSatisfy((error: NoticeError) => error.notice.code === 'reassign.machineOnline')
    expect(assignments.machineOf('p', 'ABC-1')).toBe('laptop')
    expect(moved).toEqual([])
  })
})
