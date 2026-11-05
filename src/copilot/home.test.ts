import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copilotEnv, eventsFile, loginCommand, parseAuth, tokenOf, trustFolder, writeToken } from './home.js'

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
    expect(parseAuth(null, true)).toMatchObject({ loggedIn: true, authMethod: 'none' })
    expect(parseAuth('gho_x', null)).toMatchObject({ loggedIn: true, authMethod: 'api_key' })
  })

  it("counts a folder without a token signed out only when the CLI sees no sign-in in it (EKR-73)", () => {
    expect(parseAuth(null, false)).toMatchObject({ loggedIn: false, authMethod: 'none' })
    expect(parseAuth(null, null)).toMatchObject({ loggedIn: null, authMethod: 'none' })
  })

  it("gives the terminal sign-in into the folder with the sessions' binary, quoted for the platform's shell", () => {
    expect(loginCommand('/home/node/state/cli/copilot', "/home/node/.copilot-accounts/it's", 'linux'))
      .toBe("(unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN; COPILOT_HOME='/home/node/.copilot-accounts/it'\\''s' '/home/node/state/cli/copilot' login)")
    expect(loginCommand('C:\\Program Files\\copilot.exe', "C:\\Users\\O'Neil\\.copilot-accounts\\copilot", 'win32'))
      .toBe('cmd /d /v:off /c set "COPILOT_GITHUB_TOKEN=" ^& set "GH_TOKEN=" ^& set "GITHUB_TOKEN=" ^& set "COPILOT_HOME=C:\\Users\\O\'Neil\\.copilot-accounts\\copilot" ^& "C:\\Program Files\\copilot.exe" login')
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

  it('reads the comment header Copilot writes into config.json and keeps it', () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    const header = '// User settings belong in settings.json.\n// This file is managed automatically.\n'
    writeFileSync(join(dir, 'config.json'), `${header}{\n  "firstLaunchAt": "2026-10-24T00:02:54.777Z"\n}\n`)
    trustFolder(dir, join(dir, 'repo'))
    const text = readFileSync(join(dir, 'config.json'), 'utf8')
    expect(text.startsWith(header)).toBe(true)
    expect(JSON.parse(text.slice(header.length))).toEqual({ firstLaunchAt: '2026-10-24T00:02:54.777Z', trustedFolders: [join(dir, 'repo')] })
  })

  it('does not overwrite a config.json it cannot read', () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    writeFileSync(join(dir, 'config.json'), '{ broken')
    expect(() => trustFolder(dir!, join(dir!, 'repo'))).toThrow(/config\.json/)
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{ broken')
  })
})
