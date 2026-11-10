import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { CallTimeout, FolderCalls, isCallTimeout, QueueWait } from './calls.js'

const NODE = process.execPath

describe('isCallTimeout', () => {
  it('finds a timeout as it is or under the cause of a wrapping error, and nothing else', () => {
    const timeout = new CallTimeout('claude', ['agents'])
    expect(isCallTimeout(timeout)).toBe(true)
    expect(isCallTimeout(new Error('stop failed', { cause: timeout }))).toBe(true)
    expect(isCallTimeout(new Error('stop failed'))).toBe(false)
    expect(isCallTimeout('timed out')).toBe(false)
  })
})
const env = process.env

/** A child that prints its start and end times after `ms`. */
const sleeper = (ms: number) => ['-e', `const s=Date.now();setTimeout(()=>console.log(JSON.stringify([s,Date.now()])),${ms})`]

const span = (stdout: string): [number, number] => JSON.parse(stdout) as [number, number]

// `/accounts/one` spelled another way that is still the same folder on this platform: case and `\` count only on Windows.
const sameOne = process.platform === 'win32' ? '\\Accounts\\One' : '/accounts/./one/'

describe('FolderCalls', () => {
  // No bound on how fast a child starts: a full parallel run takes seconds to start one. The first call ends only once
  // the call of the other folder has run, so it ends at all only if the two folders run together.
  it('runs the calls of one folder one after another and of different folders together', { timeout: 60_000 }, async () => {
    const calls = new FolderCalls()
    const marker = join(await mkdtemp(join(tmpdir(), 'even-keel-calls-')), 'ran')
    const file = JSON.stringify(marker)
    const waiter = ['-e', `const s=Date.now();setInterval(()=>{if(require("fs").existsSync(${file})){console.log(JSON.stringify([s,Date.now()]));process.exit(0)}},20)`]
    const [a, b] = await Promise.all([
      calls.run('/accounts/one', NODE, waiter, { env, timeoutMs: 40_000 }),
      calls.run(sameOne, NODE, sleeper(0), { env, timeoutMs: 40_000 }),
      calls.run('/accounts/two', NODE, ['-e', `require("fs").writeFileSync(${file}, "")`], { env, timeoutMs: 40_000 }),
    ])
    expect(span(b.stdout)[0]).toBeGreaterThanOrEqual(span(a.stdout)[1])
  })

  it('gives up on a call past its timeout without killing it, and the folder waits for it', async () => {
    const calls = new FolderCalls()
    const started = Date.now()
    await expect(calls.run('/accounts/one', NODE, sleeper(800), { env, timeoutMs: 200 })).rejects.toBeInstanceOf(CallTimeout)
    expect(Date.now() - started).toBeLessThan(700)
    const next = await calls.run('/accounts/one', NODE, sleeper(0), { env, timeoutMs: 5_000 })
    expect(span(next.stdout)[0] - started).toBeGreaterThanOrEqual(750)
  })

  it('never starts a call whose timeout passed while it waited for the folder', async () => {
    const calls = new FolderCalls()
    const marker = join(await mkdtemp(join(tmpdir(), 'even-keel-calls-')), 'ran')
    const first = calls.run('/accounts/one', NODE, sleeper(600), { env, timeoutMs: 5_000 })
    const late = calls.run('/accounts/one', NODE, ['-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`], { env, timeoutMs: 100 })
    await expect(late).rejects.toBeInstanceOf(CallTimeout)
    await first
    const after = await calls.run('/accounts/one', NODE, ['-e', 'console.log("next")'], { env, timeoutMs: 5_000 })
    expect(after.stdout.trim()).toBe('next')
    expect(existsSync(marker)).toBe(false)
  })

  // The next call gets the folder only after the kill: left alone, the first one holds it past the next one's timeout.
  // The kill limit is the next call's too, and a child slow to start under a full parallel run is killed by it: either
  // way it got the folder, so only a timeout in the queue is a failure.
  it('kills a call that outlives the kill limit', { timeout: 60_000 }, async () => {
    const calls = new FolderCalls(300)
    await expect(calls.run('/accounts/one', NODE, sleeper(120_000), { env, timeoutMs: 100 })).rejects.toBeInstanceOf(CallTimeout)
    const next = await calls.run('/accounts/one', NODE, sleeper(0), { env, timeoutMs: 30_000 }).catch((error: unknown) => error)
    expect(isCallTimeout(next)).toBe(false)
  })

  it('starts a priority call right after the running one, ahead of the waiting ordinary calls', async () => {
    const calls = new FolderCalls()
    const quick = (priority?: boolean) => calls.run('/accounts/one', NODE, sleeper(0), { env, timeoutMs: 10_000, priority })
    const running = calls.run('/accounts/one', NODE, sleeper(500), { env, timeoutMs: 10_000 })
    const ordinary = [quick(), quick()]
    const urgent = [quick(true), quick(true)]
    const [first, a, b, p, q] = (await Promise.all([running, ...ordinary, ...urgent])).map((output) => span(output.stdout))
    expect(p[0]).toBeGreaterThanOrEqual(first[1])
    expect(q[0]).toBeGreaterThanOrEqual(p[1])
    expect(a[0]).toBeGreaterThanOrEqual(q[1])
    expect(b[0]).toBeGreaterThanOrEqual(a[1])
  })

  it('keeps the output of a failed call on its error', async () => {
    const calls = new FolderCalls()
    const failed = calls.run('/accounts/one', NODE, ['-e', 'console.log("{}");process.exit(1)'], { env, timeoutMs: 5_000 })
    await expect(failed).rejects.toMatchObject({ code: 1, stdout: '{}\n' })
  })
})

describe('QueueWait', () => {
  const timedOut = () => new CallTimeout('claude', ['agents', '--json', '--all'])
  /** A call that times out in the queue after `ms` the first `times` times, then answers at once. */
  const clogged = (times: number, ms = 0) => {
    let left = times
    return async () => {
      if (left-- <= 0) return 'answer'
      await delay(ms)
      throw timedOut()
    }
  }

  // EKR-102: right after the service's start the folder's queue was full of /context probes, and the chain paused.
  it('tries again a call that timed out in the folder queue', async () => {
    await expect(new QueueWait(1_000).call(clogged(2))).resolves.toBe('answer')
  })

  it('does not count the time a call lost in the queue against the wait', async () => {
    const wait = new QueueWait(100, 5_000)
    await wait.call(clogged(1, 300))
    expect(wait.open).toBe(true)
  })

  it('gives up once the patience is over', async () => {
    const wait = new QueueWait(10, 150)
    await expect(wait.call(clogged(100, 40))).rejects.toBeInstanceOf(CallTimeout)
    expect(wait.open).toBe(false)
  })

  it('throws any other failure at once', async () => {
    let calls = 0
    const failing = () => {
      calls++
      return Promise.reject(new Error('exit code 1'))
    }
    await expect(new QueueWait(1_000).call(failing)).rejects.toThrow('exit code 1')
    expect(calls).toBe(1)
  })
})
