import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { runPlan, type UpdatePlan } from '../updates/runner.js'
import { scaled } from '../../test/slow-runner.js'

it('restores and rebuilds the running commit when a same-version hub answers from the wrong commit, then takes the next green', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-rebuild-'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' }).trim()
  const commit = (marker: string) => {
    writeFileSync(join(root, 'marker'), marker)
    git('add', 'marker')
    git('commit', '-qm', marker)
    return git('rev-parse', 'HEAD')
  }
  try {
    git('init', '-qb', 'dev')
    git('config', 'user.name', 'Example')
    git('config', 'user.email', 'test@example.com')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { build: 'node build.cjs' } }))
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' } } }))
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').copyFileSync('marker', 'built')")
    git('add', 'package.json', 'package-lock.json', 'build.cjs')
    const old = commit('running')
    commit('skipped')
    const broken = commit('broken')
    const plan: UpdatePlan = {
      mode: 'rebuild', root, home: root, install: null, target: { version: '1.0.0', tag: broken },
      from: { commit: old, version: '1.0.0', branch: 'dev', tag: null, storage: null },
      service: { start: [process.execPath, '-e', ''], stop: [process.execPath, '-e', ''] },
      state: 'http://localhost/api/state', startedAt: 'before', settleMs: 0, answerMs: 1000, steadyMs: 1,
      log: join(root, 'update.log'), result: join(root, 'update.json'),
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const marker = readFileSync(join(root, 'built'), 'utf8')
      return Response.json({ startedAt: marker, updates: { current: '1.0.0' }, hubCommit: marker === 'broken' ? old : git('rev-parse', 'HEAD') })
    })
    const failed = await runPlan(plan)
    expect(failed).toMatchObject({ failed: { step: 'answer' }, rollback: { failed: null }, from: { commit: old }, to: { tag: broken } })
    expect(git('rev-parse', 'HEAD')).toBe(old)
    expect(git('branch', '--show-current')).toBe('dev')
    expect(readFileSync(join(root, 'built'), 'utf8')).toBe('running')
    expect(readFileSync(plan.log, 'utf8')).toMatch(/ ci --no-audit --no-fund/)

    git('merge', '--ff-only', broken)
    const next = commit('fixed')
    expect(await runPlan({ ...plan, startedAt: 'running', target: { version: '1.0.0', tag: next } })).toMatchObject({ failed: null, rollback: null })
    expect(git('rev-parse', 'HEAD')).toBe(next)
  } finally {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  }
}, scaled(60_000))
