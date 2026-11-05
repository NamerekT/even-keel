import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CopilotCli } from './cli.js'
import { copilotEnv, writeToken } from './home.js'
import { machineSignedIn } from './machine.js'

vi.mock('./machine.js', () => ({ machineSignedIn: vi.fn() }))
const probe = vi.mocked(machineSignedIn)
const dirs: string[] = []
afterEach(() => {
  probe.mockReset()
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'copilot-auth-'))
  dirs.push(dir)
  const home = { key: 'copilot', dir, agent: 'copilot', global: false }
  const cli = new CopilotCli(() => 'copilot', 1000,
    (folder) => copilotEnv({ COPILOT_GITHUB_TOKEN: 'gho_inherited', GH_TOKEN: 'gho_other', GITHUB_TOKEN: 'gho_other' }, folder.dir), {} as never)
  return { cli, home }
}

it('rechecks the session folder on refresh, with inherited tokens removed (EKR-73)', async () => {
  const { cli, home } = setup()
  probe.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await cli.authStatus(home)).toMatchObject({ loggedIn: false, authMethod: 'none' })
  expect(probe.mock.calls[0]).toEqual(['copilot', { COPILOT_HOME: home.dir, COPILOT_AUTO_UPDATE: 'false', EVEN_KEEL_AGENT: 'copilot' }, home.dir, 1000])
  expect(cli.terminalLogin(home)).toContain('COPILOT_HOME')
  expect(await cli.authStatus(home)).toMatchObject({ loggedIn: true, authMethod: 'none' })
})

it('keeps an own token ahead of the machine sign-in and offers no terminal command', async () => {
  const { cli, home } = setup()
  writeToken(home.dir, 'gho_example')
  expect(await cli.authStatus(home)).toMatchObject({ loggedIn: true, authMethod: 'api_key' })
  expect(probe).not.toHaveBeenCalled()
  expect(cli.terminalLogin(home)).toBeUndefined()
})

it('reports unknown without a signed-in assumption and rechecks after refresh and restart', async () => {
  const { cli, home } = setup()
  probe.mockResolvedValueOnce(null).mockResolvedValueOnce(false).mockResolvedValueOnce(null).mockResolvedValueOnce(true).mockResolvedValueOnce(null)
  for (const loggedIn of [null, false, null, true]) {
    expect(await cli.authStatus(home)).toMatchObject({ loggedIn, authMethod: 'none' })
  }
  const restarted = new CopilotCli(() => 'copilot', 1000, (folder) => copilotEnv({}, folder.dir), {} as never)
  expect(await restarted.authStatus(home)).toMatchObject({ loggedIn: null })
  expect(probe).toHaveBeenCalledTimes(5)
})
