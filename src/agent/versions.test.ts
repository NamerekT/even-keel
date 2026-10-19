import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { claude } from '../claude/adapter.js'
import { codex } from '../codex/adapter.js'
import { cliVersionOf, VersionWatcher, type VersionedAgent } from './versions.js'

describe('the checked versions', () => {
  it('are the ones the README names under "Before you run it"', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    expect(readme).toContain(`Last checked against **Claude Code ${claude.checked}**`)
    expect(readme).toContain(`Last checked against **codex-cli ${codex.checked}**`)
  })
})

describe('cliVersionOf', () => {
  it('reads the version out of what each CLI prints', () => {
    expect(cliVersionOf('2.1.303 (Claude Code)\n')).toBe('2.1.303')
    expect(cliVersionOf('codex-cli 0.162.1\n')).toBe('0.162.1')
    expect(cliVersionOf('codex-cli 0.163.0-alpha.2')).toBe('0.163.0-alpha.2')
  })

  it('gives nothing for an answer without a version', () => {
    expect(cliVersionOf('')).toBeNull()
    expect(cliVersionOf('unknown option --version')).toBeNull()
  })
})

function agent(name: string, answer: string | Error, installed = true): VersionedAgent & { answer: string | Error } {
  const entry = {
    name,
    title: name === 'claude' ? 'Claude Code' : 'Codex',
    checked: name === 'claude' ? '2.1.301' : '0.162.1',
    answer,
    installed: () => installed,
    version: async () => {
      if (entry.answer instanceof Error) throw entry.answer
      return entry.answer
    },
  }
  return entry
}

function watcher(agents: VersionedAgent[]) {
  const log: string[] = []
  let changes = 0
  const watch = new VersionWatcher({ agents: () => agents, intervalMs: 60_000, onChange: () => changes++, log: (line) => log.push(line) })
  return { watch, log, changes: () => changes }
}

describe('VersionWatcher', () => {
  it('shows a CLI whose version differs from the checked one, older or newer, and not one that matches', async () => {
    const { watch, log, changes } = watcher([agent('claude', '2.1.303 (Claude Code)'), agent('codex', 'codex-cli 0.162.1')])
    await watch.check()
    expect(watch.view()).toEqual([
      {
        agent: 'claude',
        installed: '2.1.303',
        checked: '2.1.301',
        notice: { code: 'agent.uncheckedVersion', params: { title: 'Claude Code', installed: '2.1.303', checked: '2.1.301' } },
      },
    ])
    expect(changes()).toBe(1)
    expect(log).toEqual(['agents: Claude Code 2.1.303 is installed, Even Keel was last checked against 2.1.301; a part of it may not work until it is adapted'])

    const older = watcher([agent('codex', 'codex-cli 0.160.0')])
    await older.watch.check()
    expect(older.watch.view().map((each) => each.installed)).toEqual(['0.160.0'])
  })

  it('tells the page only when something changed, and drops a CLI updated back to the checked version', async () => {
    const claude = agent('claude', '2.1.303 (Claude Code)')
    const { watch, changes } = watcher([claude])
    await watch.check()
    await watch.check()
    expect(changes()).toBe(1)

    claude.answer = '2.1.304 (Claude Code)'
    await watch.check()
    expect(watch.view()[0]!.installed).toBe('2.1.304')
    expect(changes()).toBe(2)

    claude.answer = '2.1.301 (Claude Code)'
    await watch.check()
    expect(watch.view()).toEqual([])
    expect(changes()).toBe(3)
  })

  it('skips a CLI that is not installed and keeps what was known when the call fails, logging a failure once', async () => {
    const claude = agent('claude', '2.1.303 (Claude Code)')
    const { watch, log } = watcher([claude, agent('codex', 'codex-cli 0.170.0', false)])
    await watch.check()
    expect(watch.view().map((each) => each.agent)).toEqual(['claude'])

    claude.answer = new Error('spawn EBUSY')
    await watch.check()
    await watch.check()
    expect(watch.view().map((each) => each.installed)).toEqual(['2.1.303'])
    expect(log.filter((line) => line.includes('EBUSY'))).toEqual(['agents: could not read the version of Claude Code: spawn EBUSY'])

    claude.answer = 'garbage'
    await watch.check()
    expect(log.at(-1)).toBe('agents: could not read the version of Claude Code: no version in "garbage"')
  })
})
