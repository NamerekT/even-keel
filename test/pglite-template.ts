import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { TestProject } from 'vitest/node'
import { openDatabase, STEPS } from '../src/storage/database.js'
import { copyTemplate, templateFiles, type TemplateFiles } from './copy-template.js'

export interface DatabaseTemplate extends TemplateFiles {
  dump: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteTemplate: DatabaseTemplate
    databaseTemplates: { sqlite: DatabaseTemplate; current: DatabaseTemplate }
  }
}

/** Real schema steps run here, outside the test workers and their template mocks. */
export default async function setup(project: TestProject): Promise<() => void> {
  const root = mkdtempSync(join(tmpdir(), 'even-keel-pglite-'))
  const cleanup = () => rmSync(root, { recursive: true, force: true })
  const save = async (name: string, db: PGlite): Promise<DatabaseTemplate> => {
    const dump = join(root, `${name}.tar`)
    try {
      writeFileSync(dump, Buffer.from(await (await db.dumpDataDir('none')).arrayBuffer()))
    } finally {
      await db.close()
    }
    return { ...templateFiles(join(root, name)), dump }
  }
  try {
    const fresh = await save('fresh', await PGlite.create({ dataDir: join(root, 'fresh') }))
    await copyTemplate(fresh, join(root, 'sqlite'))
    const sqlite = await save('sqlite', await openDatabase(join(root, 'sqlite'), STEPS.slice(0, 1)))
    await copyTemplate(fresh, join(root, 'current'))
    const current = await save('current', await openDatabase(join(root, 'current')))
    project.provide('pgliteTemplate', fresh)
    project.provide('databaseTemplates', { sqlite, current })
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}
