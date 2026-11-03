import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Harness } from './service.fixture.js'

const HULY_ENV = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'example', HULY_TOKEN: 'token' }

/** Where each start asked to install the Huly client. */
const installs: string[] = []

describe('a start with a Huly profile and no Huly client end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    installs.length = 0
    run = new Harness()
    // The npm package has no client in its own `node_modules`: the service's client resolves nothing there, and its install goes nowhere.
    vi.doMock('../huly/client.js', async (original) => {
      const actual = await original<typeof import('../huly/client.js')>()
      const nowhere = Object.assign(() => { throw new Error('no client') }, { resolve: () => { throw new Error('no client') } }) as unknown as NodeJS.Require
      const client = new actual.HulyClient({
        dir: () => join(run.dir, 'data', 'state', 'huly-client'),
        own: nowhere,
        install: async (dir) => void installs.push(dir),
        log: (line) => console.log(line),
      })
      return { ...actual, hulyClient: client, installForProfiles: (profiles: readonly { kind: string }[]) => actual.installForProfiles(profiles, client) }
    })
  })

  afterEach(async () => {
    await run.stop()
    vi.doUnmock('../huly/client.js')
  })

  const hulyProfiles = () => run.service.profiles.current().profiles.filter((profile) => profile.kind === 'huly')

  it('starts on the first start and on every later one, installing the client each time (EKR-52)', async () => {
    await run.start(() => Object.assign(process.env, HULY_ENV))
    expect(hulyProfiles()).toHaveLength(1)
    await run.until(() => installs.length === 1, 'the client install asked for')
    expect(run.service.getState().hulyClient).not.toBeUndefined()

    await run.restart(() => {
      for (const name of Object.keys(HULY_ENV)) delete process.env[name]
    })
    expect(hulyProfiles()).toHaveLength(1)
    await run.until(() => installs.length === 2, 'the client install asked for again')
  })
})
