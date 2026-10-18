import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteTemplate: { dir: string; dump: string }
  }
}

/** One fresh PGlite cluster per test run, as a folder and as a dump, for `test/pglite.ts` to start new databases from. */
export default async function setup(project: TestProject): Promise<() => void> {
  const root = mkdtempSync(join(tmpdir(), 'even-keel-pglite-'))
  const dir = join(root, 'pgdata')
  const dump = join(root, 'fresh.tar')
  const db = await PGlite.create({ dataDir: dir })
  writeFileSync(dump, Buffer.from(await (await db.dumpDataDir('none')).arrayBuffer()))
  await db.close()
  project.provide('pgliteTemplate', { dir, dump })
  return () => rmSync(root, { recursive: true, force: true })
}
