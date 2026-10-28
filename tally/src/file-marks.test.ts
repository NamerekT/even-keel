import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { loadFile } from './load.js'
import { launchMap } from './parse.js'

it('keeps read offsets outside the scan and forgets only missing files, including with an empty scan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-marks-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  try {
    const kept = join(dir, 'kept.jsonl')
    const gone = join(dir, 'gone.jsonl')
    const source = (path: string) => ({ path, account: 'global' })
    const context = { account: 'global', launches: launchMap([]) }
    for (const [path, uuid] of [[kept, 'kept'], [gone, 'gone']]) {
      writeFileSync(path!, JSON.stringify({ type: 'user', uuid, sessionId: 's1', message: { content: 'hi' } }) + '\n')
      await loadFile(source(path!), undefined, db, context, 1024)
    }
    const before = (await db.files()).get(kept)
    expect(before?.offset).toBeGreaterThan(0)
    expect(await db.forgetFilesExcept([gone])).toBe(0)
    expect((await db.files()).get(kept)).toEqual(before)
    expect(await db.forgetFilesExcept([])).toBe(0)
    expect((await db.files()).get(kept)).toEqual(before)
    rmSync(gone)
    expect(await db.forgetFilesExcept([kept])).toBe(1)
    expect(await db.files()).toEqual(new Map([[kept, before]]))
    expect(await loadFile(source(kept), before, db, context, 1024)).toBe(0)
  } finally {
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)
