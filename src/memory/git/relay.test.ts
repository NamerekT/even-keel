import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../../git/run.js'
import type { GitAnswer, GitRequest } from '../../link/protocol.js'
import { memoryFile } from '../record.js'
import { parseCgi } from './backend.js'
import { hubMemoryGit } from './hub-git.js'
import { MemoryRelay } from './relay.js'
import { MEMORY_BRANCH, MemorySync } from './sync.js'

const PROJECT = '0b5f7e1a-1111-4222-8333-944455556666'
const MACHINE = 'machine-1'

let root: string
let repository: string
let logs: string[]
let pushes: string[]
let online: boolean
let relays: MemoryRelay[]
let placed: boolean

const hub = () =>
  hubMemoryGit({
    placed: async (project, machine) => placed && project === PROJECT && machine === MACHINE,
    bound: () => false,
    repository: (project) => (project === PROJECT ? repository : null),
    pushed: (project) => pushes.push(project),
    log: (line) => logs.push(line),
  })

async function relay(machine = MACHINE): Promise<MemoryRelay> {
  const answer = hub()
  const made = new MemoryRelay({
    send: async (project: string, request: GitRequest): Promise<GitAnswer | undefined> => (online ? answer(machine, project, JSON.parse(JSON.stringify(request))) : undefined),
    log: (line) => logs.push(line),
  })
  await made.start()
  relays.push(made)
  return made
}

function copy(name: string, at: MemoryRelay): MemorySync {
  return new MemorySync({
    folder: join(root, name),
    remote: at.originOf(PROJECT),
    author: name,
    log: (line) => logs.push(line),
    schedule: () => () => {},
    watch: () => () => {},
  })
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'even-keel-memory-relay-'))
  repository = join(root, `${PROJECT}.git`)
  logs = []
  pushes = []
  online = true
  placed = true
  relays = []
  const made = await runGit(root, ['init', '-q', '--bare', '-b', MEMORY_BRANCH, repository])
  if (made.code !== 0) throw new Error(made.out)
})

afterEach(async () => {
  await Promise.all(relays.map((each) => each.close()))
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('MemoryRelay', { timeout: 120_000 }, () => {
  it('carries a working copy of a machine to the hub repository and back to another copy', async () => {
    const first = copy('first', await relay())
    await first.start()
    writeFileSync(join(root, 'first', 'trap.md'), memoryFile({ name: 'trap', description: 'A trap', type: 'project', body: 'Body.' }))
    expect((await first.sync()).reached).toBe(true)
    expect(pushes).toContain(PROJECT)
    const second = copy('second', await relay())
    expect((await second.start()).reached).toBe(true)
    expect(readFileSync(join(root, 'second', 'trap.md'), 'utf8')).toContain('A trap')
    first.stop()
    second.stop()
  })

  it('keeps the commits on the machine while the link is down and pushes them once it is back', async () => {
    const first = copy('first', await relay())
    await first.start()
    online = false
    writeFileSync(join(root, 'first', 'offline.md'), memoryFile({ name: 'offline', description: 'Written offline', type: 'project', body: 'Body.' }))
    const away = await first.sync()
    expect(away.reached).toBe(false)
    expect(away.committed).toContain('offline.md')
    online = true
    expect((await first.sync()).reached).toBe(true)
    const listed = await runGit(repository, ['ls-tree', '--name-only', MEMORY_BRANCH])
    expect(listed.out).toContain('offline.md')
    first.stop()
  })

  it('refuses a machine without the project in its pool or a bound folder, once in the log', async () => {
    placed = false
    const first = copy('first', await relay())
    expect((await first.start()).reached).toBe(false)
    await first.sync()
    expect(logs.filter((line) => line.includes('refused'))).toHaveLength(1)
    expect(existsSync(join(root, 'first'))).toBe(true)
    first.stop()
  })
})

describe('parseCgi', () => {
  it('reads the status, the type and the body after a blank line', () => {
    const answer = parseCgi(Buffer.from('Status: 404 Not Found\r\nContent-Type: text/plain\r\n\r\nnone'))
    expect(answer).toEqual({ status: 404, contentType: 'text/plain', body: Buffer.from('none').toString('base64') })
  })
})
