import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigFile } from './config-file.js'
import { DEFAULT_CI } from './config.js'

const ci = DEFAULT_CI

describe('ConfigFile', () => {
  let dir: string
  let file: string
  let warnings: string[]
  let changes: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-config-'))
    file = join(dir, 'even-keel.config.json')
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
    expect(config.error?.code).toBe('config.notJson')
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
    expect(warnings).toEqual(['config: port changed and wait for a restart of Even Keel'])
  })

  it('writes the settings of a project, keeps the other keys and applies them at once', () => {
    write({ port: 5000, projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', slot: 2 } }, custom: { kept: true } })
    const config = open()

    config.saveProject('ABC', { prompt: ' Mind Library. ', beforeStart: ['npm ci', ' '], check: ['npm test'], ci: { kinds: ['github'], waitMinutes: 20, recheckMain: true }, fillMilestone: true })
    config.saveProject('XYZ', { prompt: 'Run tests.', beforeStart: [], check: [], ci, fillMilestone: false })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      port: 5000,
      projects: {
        ABC: { repo: 'C:\\abc', prompt: 'Mind Library.', commands: { beforeStart: ['npm ci'], check: ['npm test'] }, ci: { kinds: ['github'], waitMinutes: 20 }, fillMilestone: true },
        XYZ: { repo: 'C:\\xyz', slot: 2, prompt: 'Run tests.' },
      },
      custom: { kept: true },
    })
    expect(config.current.settings.ABC).toEqual({
      prompt: 'Mind Library.',
      beforeStart: ['npm ci'],
      check: ['npm test'],
      ci: { kinds: ['github'], waitMinutes: 20, recheckMain: true },
      fillMilestone: true,
    })
  })

  it('removes the keys of cleared settings', () => {
    write({ projects: { ABC: { repo: 'C:\\abc', brief: false, prompt: 'Old.', commands: { beforeStart: ['npm ci'], check: ['npm test'] }, ci: { waitMinutes: 5 } } } })
    const config = open()

    config.saveProject('ABC', { prompt: '', beforeStart: [], check: [], ci, fillMilestone: false })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ projects: { ABC: { repo: 'C:\\abc', brief: false } } })
  })

  it('refuses a project the config does not know and leaves the file as it is', () => {
    write({ projects: { ABC: 'C:\\abc' } })
    const config = open()

    expect(() => config.saveProject('XYZ', { prompt: 'Hi.', beforeStart: [], check: [], ci, fillMilestone: false })).toThrow(/XYZ/)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ projects: { ABC: 'C:\\abc' } })
  })
})
