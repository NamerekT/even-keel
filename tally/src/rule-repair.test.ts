import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { refreshRuleChanges } from './rule-steps.js'

it('repairs only unchanged global deletion/restoration pairs in the incident window, once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tally-repair-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  const client = new pg.Client(local.settings)
  await client.connect()
  try {
    await db.setMeta('rules_bootstrap', '2026-10-28T20:00:00.000Z')
    await client.query(`insert into rule_snapshots (key, at, hash) values
      ('~/.claude/skills/same/skill.md', '2026-10-28 20:00Z', 'a'),
      ('~/.claude/skills/same/skill.md', '2026-10-28 22:35Z', null),
      ('~/.claude/skills/same/skill.md', '2026-10-28 23:04Z', 'a'),
      ('~/.claude/skills/same/skill.md', '2026-10-28 23:06Z', null),
      ('~/.claude/skills/same/skill.md', '2026-10-28 23:08Z', 'a'),
      ('~/.claude/changed/claude.md', '2026-10-28 20:00Z', 'a'),
      ('~/.claude/changed/claude.md', '2026-10-28 22:35Z', null),
      ('~/.claude/changed/claude.md', '2026-10-28 23:04Z', 'b'),
      ('~/.claude/deleted/claude.md', '2026-10-28 20:00Z', 'a'),
      ('~/.claude/deleted/claude.md', '2026-10-28 22:35Z', null),
      ('~/.claude/new/claude.md', '2026-10-28 22:35Z', null),
      ('~/.claude/new/claude.md', '2026-10-28 23:04Z', 'a'),
      ('~/.claude/outside/claude.md', '2026-10-28 20:00Z', 'a'),
      ('~/.claude/outside/claude.md', '2026-10-28 22:34:59Z', null),
      ('~/.claude/outside/claude.md', '2026-10-28 23:04Z', 'a'),
      ('~/.claude/late/claude.md', '2026-10-28 20:00Z', 'a'),
      ('~/.claude/late/claude.md', '2026-10-28 23:06Z', null),
      ('~/.claude/late/claude.md', '2026-10-28 23:09Z', 'a'),
      ('/projects/git/repos/example/claude.md', '2026-10-28 20:00Z', 'a'),
      ('/projects/git/repos/example/claude.md', '2026-10-28 23:00:59Z', 'b'),
      ('/projects/git/repos/example/claude.md', '2026-10-28 23:06Z', null),
      ('/projects/git/repos/example/claude.md', '2026-10-28 23:08Z', 'b')`)
    await refreshRuleChanges(db)
    const before = await db.ruleChangeIds()
    const last = await db.lastSnapshots()
    expect(await db.repairGlobalRuleSnapshots()).toBe(4)
    expect(await db.meta('rules_global_scan_repair_20261028')).toBe('4')
    expect(await db.lastSnapshots()).toEqual(last)
    await refreshRuleChanges(db)
    expect((await db.ruleChangeIds()).size).toBe(before.size - 4)
    const { snapshots } = await db.ruleVersions()
    expect(snapshots.filter(({ key }) => key === '~/.claude/skills/same/skill.md')).toEqual([
      { key: '~/.claude/skills/same/skill.md', at: '2026-10-28T20:00:00.000Z', hash: 'a' },
    ])
    expect(snapshots).toHaveLength(18)
    expect(await db.repairGlobalRuleSnapshots()).toBe(0)
    expect(await db.meta('rules_global_scan_repair_20261028')).toBe('4')
    // A completed repair does not sweep up subsequently imported history.
    await client.query(`insert into rule_snapshots (key, at, hash) values
      ('~/.claude/imported/claude.md', '2026-10-28 20:00Z', 'c'),
      ('~/.claude/imported/claude.md', '2026-10-28 22:35Z', null),
      ('~/.claude/imported/claude.md', '2026-10-28 23:04Z', 'c')`)
    expect(await db.repairGlobalRuleSnapshots()).toBe(0)
    expect((await db.ruleVersions()).snapshots).toHaveLength(21)
  } finally {
    await client.end()
    await db.close()
    await local.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)
