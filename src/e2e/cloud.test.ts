import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Harness } from './service.fixture.js'

const FOUNDRY = { cloud: 'foundry', way: 'apiKey', key: 'fake-foundry-key', resource: 'my-resource', models: { sonnet: 'my-sonnet' } }
const spend = { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, cost: 0, durationMs: 1 }

describe('cloud accounts end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const foundryAccount = () => run.service.account.view.accounts.find((entry) => entry.key === 'foundry')

  it('keeps a Microsoft Foundry account whose check turn answered, its connection in the folder’s settings (BTN-824)', async () => {
    const checked: string[] = []
    run.agent.oneTurn = async (home) => {
      checked.push(home.key)
      return { text: 'ok', spend: { ...spend, model: 'my-sonnet' } }
    }
    await run.start()
    await run.post('account/cloud', FOUNDRY)
    expect(checked).toEqual(['foundry'])
    expect(foundryAccount()).toMatchObject({ apiKey: false, cloud: { cloud: 'foundry', way: 'apiKey', resource: 'my-resource', shortLived: false }, checkedModel: 'my-sonnet' })
    const settings = JSON.parse(readFileSync(join(run.dir, 'accounts', 'foundry', 'settings.json'), 'utf8')) as { env: Record<string, string> }
    expect(settings.env).toMatchObject({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_RESOURCE: 'my-resource',
      ANTHROPIC_FOUNDRY_API_KEY: 'fake-foundry-key',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'my-sonnet',
    })
  })

  it('removes a Foundry folder whose check found no Azure sign-in and says whose sign-in was looked for', async () => {
    run.agent.oneTurn = async () => {
      throw new Error('Failed to get token from azureADTokenProvider: ChainedTokenCredential authentication failed')
    }
    await run.start()
    const refusal = await run.refused('account/cloud', { ...FOUNDRY, way: 'entra' })
    expect(refusal.code).toBe('cloud.azureCredentials')
    expect(foundryAccount()).toBeUndefined()
    expect(existsSync(join(run.dir, 'accounts', 'foundry'))).toBe(false)
  })

  it('refuses an address for a resource name before any folder or check', async () => {
    let checks = 0
    run.agent.oneTurn = async () => {
      checks++
      return { text: 'ok', spend: { ...spend, model: null } }
    }
    await run.start()
    expect((await run.refused('account/cloud', { ...FOUNDRY, resource: 'my-resource.services.ai.azure.com' })).code).toBe('account.foundryEndpoint')
    expect((await run.refused('account/cloud', { ...FOUNDRY, models: {} })).code).toBe('account.foundryModels')
    expect(checks).toBe(0)
    expect(foundryAccount()).toBeUndefined()
  })
})
