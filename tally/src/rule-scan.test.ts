import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { ruleSources } from './rule-scan.js'
import { snapshotRules } from './rule-steps.js'

it('keeps snapshots of an existing account omitted from the scan, then detects an actual deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tally-rules-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  try {
    const account = { key: 'global', dir: join(dir, '.claude'), global: true, agent: 'claude' }
    const skill = join(account.dir, 'skills', 'example')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), 'Example rule')
    await snapshotRules(db, await ruleSources([account], [], dir, () => {}), new Date('2026-10-29T10:00Z'))
    const before = await db.lastSnapshots()
    expect(before.get('~/.claude/skills/example/skill.md')).toBeTypeOf('string')
    expect(await snapshotRules(db, await ruleSources([], [], dir, () => {}), new Date('2026-10-29T10:05Z'))).toBe(0)
    expect(await db.lastSnapshots()).toEqual(before)
    await rm(join(skill, 'SKILL.md'))
    expect(await snapshotRules(db, await ruleSources([account], [], dir, () => {}), new Date('2026-10-29T10:10Z'))).toBe(1)
    expect((await db.lastSnapshots()).get('~/.claude/skills/example/skill.md')).toBeNull()
    await writeFile(join(skill, 'SKILL.md'), 'Example rule')
    await snapshotRules(db, await ruleSources([account], [], dir, () => {}), new Date('2026-10-29T10:15Z'))
    await rm(skill, { recursive: true })
    expect(await snapshotRules(db, await ruleSources([account], [], dir, () => {}), new Date('2026-10-29T10:20Z'))).toBe(1)
  } finally {
    await db.close()
    await local.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)
