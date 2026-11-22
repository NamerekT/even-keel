import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPlan, type UpdatePlan } from '../updates/runner.js'

// A chain session merging into the checkout while the rebuild runs (BTN-1426): `hook.cjs` beside the checkout plays
// the merge once, from the build or the service's start.

let base: string
let root: string
const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' }).trim()
const armed = () => join(base, 'armed')

function commit(marker: string, version = '1.0.0'): string {
  writeFileSync(join(root, 'marker'), marker)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version, scripts: { build: 'node build.cjs' } }))
  git('add', 'marker', 'package.json')
  git('commit', '-qm', marker)
  return git('rev-parse', 'HEAD')
}

/** The merge the hook plays once: `onward` — a new commit on the branch, `away` — the branch reset to another line. */
function arm(how: 'onward' | 'away'): void {
  const script = [
    "const { execFileSync } = require('node:child_process')",
    "const fs = require('node:fs')",
    `if (fs.existsSync(${JSON.stringify(armed())})) {`,
    `  fs.rmSync(${JSON.stringify(armed())})`,
    `  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: ${JSON.stringify(root)} })`,
    ...(how === 'away' ? ["  git('reset', '-q', '--hard', 'HEAD~1')"] : []),
    `  fs.writeFileSync(${JSON.stringify(join(root, 'marker'))}, ${JSON.stringify(how)})`,
    `  fs.writeFileSync(${JSON.stringify(join(root, 'package.json'))}, ${JSON.stringify(JSON.stringify({ name: 'fixture', version: '1.1.0', scripts: { build: 'node build.cjs' } }))})`,
    "  git('add', 'marker', 'package.json')",
    `  git('commit', '-qm', ${JSON.stringify(how)})`,
    '}',
  ]
  writeFileSync(join(base, 'hook.cjs'), script.join('\n'))
  writeFileSync(armed(), '')
}

function planOf(target: string, install: UpdatePlan['install'], from: string, start = [process.execPath, '-e', '']): UpdatePlan {
  return {
    mode: 'rebuild', root, home: root, install, target: { version: '1.0.0', tag: target },
    from: { commit: from, version: '1.0.0', branch: 'dev', tag: null, storage: null },
    service: { start, stop: [process.execPath, '-e', ''] },
    state: 'http://localhost/api/state', startedAt: 'before', settleMs: 0, answerMs: 1000, steadyMs: 1,
    log: join(base, 'update.log'), result: join(base, 'update.json'),
  }
}

/** The service as it starts from the built tree: the built marker, the version of package.json, HEAD as its commit. */
function serve(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    return Response.json({ startedAt: readFileSync(join(root, 'built'), 'utf8'), updates: { current: version }, hubCommit: git('rev-parse', 'HEAD') })
  })
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'hub-rebuild-moved-'))
  root = join(base, 'repo')
  mkdirSync(root)
  git('init', '-qb', 'dev')
  git('config', 'user.name', 'Example')
  git('config', 'user.email', 'test@example.com')
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' } } }))
  writeFileSync(join(root, 'build.cjs'), "require('node:fs').copyFileSync('marker', 'built'); require('../hook.cjs')")
  writeFileSync(join(base, 'hook.cjs'), '')
  git('add', 'package-lock.json', 'build.cjs')
  // Installed after the lock: a build with `install: null` installs nothing.
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', '.package-lock.json'), '{}')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(base, { recursive: true, force: true })
})

describe('a rebuild whose checkout a chain moves', () => {
  it('builds again when the checkout moved on between the build and the stop', async () => {
    const running = commit('running')
    const green = commit('green')
    arm('onward')
    serve()
    const record = await runPlan(planOf(green, null, running))
    const head = git('rev-parse', 'HEAD')
    expect(head).not.toBe(green)
    expect(record).toMatchObject({ failed: null, rollback: null, to: { tag: head, version: '1.1.0' } })
    expect(readFileSync(join(root, 'built'), 'utf8')).toBe('onward')
    expect(readFileSync(join(base, 'update.log'), 'utf8')).toContain(`the checkout moved on from ${green} to ${head}`)
  }, 60_000)

  it('builds again when the checkout moved on during the build with the service down', async () => {
    const running = commit('running')
    const green = commit('green')
    arm('onward')
    serve()
    const record = await runPlan(planOf(green, 'ci', running))
    const head = git('rev-parse', 'HEAD')
    expect(record).toMatchObject({ failed: null, rollback: null, to: { tag: head, version: '1.1.0' } })
    expect(readFileSync(join(root, 'built'), 'utf8')).toBe('onward')
  }, 60_000)

  it('leaves a checkout moved to another line and starts the running service again', async () => {
    const running = commit('running')
    const green = commit('green')
    arm('away')
    serve()
    const record = await runPlan(planOf(green, null, running))
    expect(record).toMatchObject({ failed: { step: 'stop', moved: true }, rollback: { failed: null }, to: { tag: green } })
    expect(git('log', '-1', '--format=%s')).toBe('away')
  }, 60_000)

  it('builds the commit a chain moved the checkout on to after the new service failed, not the one before', async () => {
    const running = commit('running')
    const green = commit('green')
    arm('onward')
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').copyFileSync('marker', 'built')")
    git('commit', '-qam', 'no hook in the build')
    const target = git('rev-parse', 'HEAD')
    serve()
    const record = await runPlan(planOf(target, null, running, [process.execPath, join(base, 'hook.cjs')]))
    const head = git('rev-parse', 'HEAD')
    expect(green).not.toBe(head)
    expect(record).toMatchObject({ failed: { step: 'answer' }, rollback: { failed: null, to: { tag: head, version: '1.1.0' } }, to: { tag: target } })
    expect(readFileSync(join(root, 'built'), 'utf8')).toBe('onward')
  }, 60_000)

  it('hands a merge between the stop and the start on to the rollback at once, which stops the service once the chains settle', async () => {
    const running = commit('running')
    commit('green')
    arm('onward')
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').copyFileSync('marker', 'built')")
    git('commit', '-qam', 'no hook in the build')
    const target = git('rev-parse', 'HEAD')
    const log = join(base, 'update.log')
    // The live service took the merged task to Done and launches the next one until the rollback has waited for it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
      const head = git('rev-parse', 'HEAD')
      const launching = head !== target && !readFileSync(log, 'utf8').includes('waiting for')
      const active = launching ? [{ project: 'ABC', current: { task: 'ABC-2', sessionId: null }, paused: false, error: null }] : []
      return Response.json({ startedAt: readFileSync(join(root, 'built'), 'utf8'), updates: { current: version }, hubCommit: head, chain: { active } })
    })
    const began = Date.now()
    const record = await runPlan({ ...planOf(target, null, running, [process.execPath, join(base, 'hook.cjs')]), settleMs: 30_000, answerMs: 120_000 })
    const head = git('rev-parse', 'HEAD')
    expect(Date.now() - began).toBeLessThan(30_000)
    expect(record).toMatchObject({ failed: { step: 'answer' }, rollback: { failed: null, to: { tag: head, version: '1.1.0' } } })
    const lines = readFileSync(log, 'utf8').split('\n')
    const stop = lines.findIndex((line) => line.endsWith(' rollback: stop'))
    const waited = lines.findIndex((line) => line.endsWith(' waiting for ABC to settle'))
    expect(stop).toBeGreaterThan(-1)
    expect(waited).toBeGreaterThan(stop)
    expect(lines.findIndex((line, at) => at > stop && line.includes('$ '))).toBeGreaterThan(waited)
  }, 60_000)

  it('rolls nothing back when the checkout moved to another line after the new service failed', async () => {
    const running = commit('running')
    commit('green')
    arm('away')
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').copyFileSync('marker', 'built')")
    git('commit', '-qam', 'no hook in the build')
    const target = git('rev-parse', 'HEAD')
    serve()
    const record = await runPlan(planOf(target, null, running, [process.execPath, join(base, 'hook.cjs')]))
    expect(record).toMatchObject({ failed: { step: 'answer' }, rollback: { failed: { step: 'restore', moved: true } } })
    expect(git('log', '-1', '--format=%s')).toBe('away')
  }, 60_000)
})
