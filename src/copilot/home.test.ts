import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copilotEnv, eventsFile, parseAuth, tokenOf, trustFolder, writeToken } from './home.js'

describe('copilot home', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it("points the CLI at the folder and gives it the folder's token instead of any inherited one", () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    writeToken(dir, 'github_pat_11AAAAAAA0demo')
    const env = copilotEnv({ PATH: 'x', GH_TOKEN: 'gho_other', GITHUB_TOKEN: 'ghu_other' }, dir)
    expect(env).toMatchObject({ PATH: 'x', COPILOT_HOME: dir, COPILOT_AUTO_UPDATE: 'false', COPILOT_GITHUB_TOKEN: 'github_pat_11AAAAAAA0demo', EVEN_KEEL_AGENT: 'copilot' })
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
  })

  it("leaves a folder without a token on the CLI's own sign-in", () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    const env = copilotEnv({ COPILOT_GITHUB_TOKEN: 'gho_inherited' }, dir)
    expect(env.COPILOT_GITHUB_TOKEN).toBeUndefined()
    expect(tokenOf(dir)).toBeNull()
    expect(parseAuth(null)).toMatchObject({ loggedIn: true, authMethod: 'none' })
    expect(parseAuth('gho_x')).toMatchObject({ loggedIn: true, authMethod: 'api_key' })
  })

  it('keeps the transcripts under session-state', () => {
    expect(eventsFile(join('C:', 'acc'), 'abc')).toBe(join('C:', 'acc', 'session-state', 'abc', 'events.jsonl'))
  })

  it("adds the repository to the folder's trustedFolders and keeps the rest of config.json", () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    const repo = join(dir, 'repo')
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ banner: 'never', trustedFolders: [join(dir, 'other')] }))
    trustFolder(dir, repo)
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toEqual({ banner: 'never', trustedFolders: [join(dir, 'other'), repo] })
  })

  it('creates config.json when the folder has none and writes the path in the native spelling', () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    trustFolder(dir, `${dir.replaceAll('\\', '/')}/repo/`)
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toEqual({ trustedFolders: [join(dir, 'repo')] })
  })

  it('leaves config.json untouched when the folder is already trusted under any spelling', () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    const text = JSON.stringify({ trustedFolders: [`${join(dir, 'repo').replaceAll('\\', '/')}/`] })
    writeFileSync(join(dir, 'config.json'), text)
    trustFolder(dir, join(dir, 'repo'))
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe(text)
  })

  it('does not overwrite a config.json it cannot read', () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    writeFileSync(join(dir, 'config.json'), '{ broken')
    expect(() => trustFolder(dir!, join(dir!, 'repo'))).toThrow(/config\.json/)
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{ broken')
  })
})
