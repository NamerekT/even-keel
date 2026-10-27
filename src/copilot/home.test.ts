import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copilotEnv, eventsFile, parseAuth, tokenOf, writeToken } from './home.js'

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
})
