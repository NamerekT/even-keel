import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigFile } from './config-file.js'

describe('ConfigFile', () => {
  let dir: string
  let file: string
  let warnings: string[]
  let changes: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'baton-config-'))
    file = join(dir, 'baton.config.json')
    warnings = []
    changes = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (value: unknown) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  const open = () => new ConfigFile({ file, intervalMs: 1000, onChange: () => changes++, warn: (message) => warnings.push(message) })

  it('keeps the last working config and reports a broken file until it is fixed', () => {
    write({ projects: { ABC: 'C:\\abc' } })
    const config = open()

    write('{ "projects": ')
    config.reload()
    expect(config.error).toMatch(/JSON/)
    expect(config.current.projects).toEqual({ ABC: 'C:\\abc' })
    expect(warnings).toHaveLength(1)

    write({ chain: { requiredLabels: ['Auto'] }, projects: { ABC: 'C:\\abc' } })
    config.reload()
    expect(config.error).toBeNull()
    expect(config.current.rules.ABC?.requiredLabels).toEqual(['Auto'])
    expect(changes).toBe(2)
  })

  it('warns about the parts that wait for a restart', () => {
    write({ projects: { ABC: 'C:\\abc' } })
    const config = open()

    write({ port: 5000, projects: { ABC: 'C:\\abc' } })
    config.reload()
    expect(config.current.port).toBe(4747)
    expect(warnings).toEqual(['config: port changed and wait for a restart of Baton'])
  })
})
