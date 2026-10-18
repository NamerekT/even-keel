import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvFile, envChanges, envTargets } from './env-file.js'

describe('envChanges', () => {
  it('names the variables added, changed and removed, in order', () => {
    const before = { HULY_URL: 'https://a.example.com', GITHUB_TOKEN: 'old', LINEAR_TOKEN: 'same' }
    const after = { GITHUB_TOKEN: 'new', LINEAR_TOKEN: 'same', FORGEJO_TOKEN: 'added' }
    expect(envChanges(before, after, new Set())).toEqual(['FORGEJO_TOKEN', 'GITHUB_TOKEN', 'HULY_URL'])
  })

  it('leaves out what the environment of the process set: it goes over the file, as at the start', () => {
    expect(envChanges({ EVEN_KEEL_PORT: '4747' }, { EVEN_KEEL_PORT: '4800' }, new Set(['EVEN_KEEL_PORT']))).toEqual([])
  })
})

describe('envTargets', () => {
  it('names nobody for a variable no part of the service reads', () => {
    expect(envTargets(['SOME_OTHER_KEY'])).toEqual({ ci: false, guard: false, listen: false, tally: false, accounts: false })
  })

  it('names the CI by the Forgejo token; the trackers\' variables, GitHub\'s included, are the profiles\' now', () => {
    expect(envTargets(['FORGEJO_TOKEN'])).toMatchObject({ ci: true })
    expect(envTargets(['GITHUB_TOKEN', 'HULY_PASSWORD'])).toEqual({ ci: false, guard: false, listen: false, tally: false, accounts: false })
  })

  it('names the guard, the address, Tally and the account folders by their own variables', () => {
    expect(envTargets(['EVEN_KEEL_TOKEN'])).toMatchObject({ guard: true, listen: false })
    expect(envTargets(['EVEN_KEEL_PORT'])).toMatchObject({ guard: true, listen: true })
    expect(envTargets(['EVEN_KEEL_HOST'])).toMatchObject({ guard: true, listen: true })
    expect(envTargets(['TALLY_DB_HOST'])).toMatchObject({ tally: true })
    expect(envTargets(['TALLY_WRITER_PASSWORD'])).toMatchObject({ tally: true })
    expect(envTargets(['EVEN_KEEL_ACCOUNTS_DIR'])).toMatchObject({ accounts: true })
    expect(envTargets(['EVEN_KEEL_CODEX_ACCOUNTS_DIR'])).toMatchObject({ accounts: true })
  })

  it('restarts nothing for the variables the Tally collector reads at each pass', () => {
    expect(envTargets(['TALLY_LLM_KEY', 'TALLY_LLM_URL', 'TALLY_LLM_MODEL']).tally).toBe(false)
  })
})

describe('EnvFile', () => {
  let dir: string
  let file: string
  let env: Record<string, string | undefined>
  let changes: string[][]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-env-'))
    file = join(dir, '.env')
    env = { PATH: 'C:\\bin' }
    changes = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const open = () => {
    const envFile = new EnvFile({ file, env, intervalMs: 1000, warn: () => {} })
    envFile.subscribe((changed) => changes.push(changed))
    return envFile
  }

  it('loads the file without going over the environment of the process', () => {
    env.EVEN_KEEL_PORT = '4800'
    writeFileSync(file, 'EVEN_KEEL_PORT=4747\nHULY_TOKEN=one\n')
    open()
    expect(env).toEqual({ PATH: 'C:\\bin', EVEN_KEEL_PORT: '4800', HULY_TOKEN: 'one' })
  })

  it('applies a changed file to the environment and reports what changed', () => {
    writeFileSync(file, 'HULY_TOKEN=one\nGITHUB_TOKEN=gh\n')
    const envFile = open()
    writeFileSync(file, 'HULY_TOKEN=two\nLINEAR_TOKEN=lin\n')
    envFile.reload()
    expect(env).toEqual({ PATH: 'C:\\bin', HULY_TOKEN: 'two', LINEAR_TOKEN: 'lin' })
    expect(changes).toEqual([['GITHUB_TOKEN', 'HULY_TOKEN', 'LINEAR_TOKEN']])
  })

  it('reports a key the service itself wrote into the file and the environment, so its readers take it', () => {
    writeFileSync(file, '')
    const envFile = open()
    writeFileSync(file, 'LINEAR_TOKEN=lin\n')
    env.LINEAR_TOKEN = 'lin'
    envFile.reload()
    expect(changes).toEqual([['LINEAR_TOKEN']])
  })

  it('takes a missing file for an empty one and says nothing when nothing changed', () => {
    const envFile = open()
    envFile.reload()
    expect(changes).toEqual([])
    writeFileSync(file, 'HULY_TOKEN=one\n')
    envFile.reload()
    rmSync(file)
    envFile.reload()
    expect(env.HULY_TOKEN).toBeUndefined()
    expect(changes).toEqual([['HULY_TOKEN'], ['HULY_TOKEN']])
  })
})
