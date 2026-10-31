import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CallTimeout, FolderCalls } from './calls.js'

const NODE = process.execPath
const env = process.env

/** A child that prints its start and end times after `ms`. */
const sleeper = (ms: number) => ['-e', `const s=Date.now();setTimeout(()=>console.log(JSON.stringify([s,Date.now()])),${ms})`]

const span = (stdout: string): [number, number] => JSON.parse(stdout) as [number, number]

// `/accounts/one` spelled another way that is still the same folder on this platform: case and `\` count only on Windows.
const sameOne = process.platform === 'win32' ? '\\Accounts\\One' : '/accounts/./one/'

describe('FolderCalls', () => {
  it('runs the calls of one folder one after another and of different folders together', async () => {
    const calls = new FolderCalls()
    const [a, b, c] = await Promise.all([
      calls.run('/accounts/one', NODE, sleeper(300), { env, timeoutMs: 5_000 }),
      calls.run(sameOne, NODE, sleeper(300), { env, timeoutMs: 5_000 }),
      calls.run('/accounts/two', NODE, sleeper(300), { env, timeoutMs: 5_000 }),
    ])
    expect(span(b.stdout)[0]).toBeGreaterThanOrEqual(span(a.stdout)[1])
    expect(span(c.stdout)[0]).toBeLessThan(span(a.stdout)[1])
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

  it('kills a call that outlives the kill limit', async () => {
    const calls = new FolderCalls(300)
    const started = Date.now()
    await expect(calls.run('/accounts/one', NODE, sleeper(10_000), { env, timeoutMs: 100 })).rejects.toBeInstanceOf(CallTimeout)
    await calls.run('/accounts/one', NODE, sleeper(0), { env, timeoutMs: 5_000 })
    expect(Date.now() - started).toBeLessThan(3_000)
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
