import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { cloudConnectionOf, cloudEnv, cloudOf, foundryEndpointOf, isCloudVariable } from './cloud.js'

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (reason) {
    return reason instanceof NoticeError ? reason.notice.code : 'not a notice'
  }
  return undefined
}

describe('cloudEnv', () => {
  it('keeps only the profile name and the region for a profile', () => {
    expect(cloudEnv({ cloud: 'bedrock', region: 'eu-central-1', auth: { way: 'profile', profile: 'work' } })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'eu-central-1',
      AWS_PROFILE: 'work',
    })
  })

  it('puts a Bedrock API key into AWS_BEARER_TOKEN_BEDROCK', () => {
    expect(cloudEnv({ cloud: 'bedrock', auth: { way: 'apiKey', key: 'ABSKfake0000' } })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'ABSKfake0000',
    })
  })

  it('writes both keys and the optional session token', () => {
    expect(cloudEnv({ cloud: 'bedrock', auth: { way: 'keys', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake/secret' } })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_ACCESS_KEY_ID: 'AKIAFAKE',
      AWS_SECRET_ACCESS_KEY: 'fake/secret',
    })
    expect(cloudEnv({ cloud: 'bedrock', auth: { way: 'keys', accessKeyId: 'AKIAFAKE', secretAccessKey: 's', sessionToken: 'tok' } })).toMatchObject({
      AWS_SESSION_TOKEN: 'tok',
    })
  })

  it('stores nothing of the credentials for the service environment, only pinned models and the prefix', () => {
    expect(
      cloudEnv({
        cloud: 'bedrock',
        auth: { way: 'environment' },
        models: { opus: 'us.anthropic.claude-opus-fake', haiku: '' },
        regionPrefix: 'eu',
      }),
    ).toEqual({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_DEFAULT_OPUS_MODEL: 'us.anthropic.claude-opus-fake', ANTHROPIC_BEDROCK_REGION_PREFIX: 'eu' })
  })
})

describe('cloudOf', () => {
  it('is null for a folder that does not turn Bedrock on', () => {
    expect(cloudOf({})).toBeNull()
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '0', AWS_PROFILE: 'work' })).toBeNull()
    expect(cloudOf({ ANTHROPIC_API_KEY: 'sk-ant-fake' })).toBeNull()
  })

  it('reads the way back from the env the form wrote, without a secret', () => {
    const env = cloudEnv({ cloud: 'bedrock', region: 'us-west-2', auth: { way: 'profile', profile: 'work' }, models: { sonnet: 'us.anthropic.fake' } })
    expect(cloudOf(env)).toEqual({ cloud: 'bedrock', region: 'us-west-2', way: 'profile', profile: 'work', models: { sonnet: 'us.anthropic.fake' }, shortLived: false })
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: 'TRUE', AWS_ACCESS_KEY_ID: 'AKIAFAKE', AWS_SECRET_ACCESS_KEY: 's' })).toEqual({
      cloud: 'bedrock',
      region: null,
      way: 'keys',
      models: {},
      shortLived: false,
    })
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1' })?.way).toBe('environment')
  })

  it('takes the API key over the other credentials, as the CLI does', () => {
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'ABSKfake', AWS_PROFILE: 'work' })?.way).toBe('apiKey')
  })

  it('tells short-lived credentials: a short-term key, a session token, a profile the AWS files mark', () => {
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'bedrock-api-key-fake' })?.shortLived).toBe(true)
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'ABSKfake' })?.shortLived).toBe(false)
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_ACCESS_KEY_ID: 'A', AWS_SECRET_ACCESS_KEY: 's', AWS_SESSION_TOKEN: 't' })?.shortLived).toBe(true)
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'sso' }, (profile) => profile === 'sso')?.shortLived).toBe(true)
    expect(cloudOf({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'work' }, (profile) => profile === 'sso')?.shortLived).toBe(false)
  })
})

describe('cloudConnectionOf', () => {
  it('trims the fields and drops the empty optional ones', () => {
    expect(
      cloudConnectionOf({ cloud: 'bedrock', way: 'profile', profile: ' work ', region: ' ', models: { opus: ' us.anthropic.fake ', sonnet: '' }, regionPrefix: '' }),
    ).toEqual({ cloud: 'bedrock', auth: { way: 'profile', profile: 'work' }, models: { opus: 'us.anthropic.fake' } })
    expect(
      cloudConnectionOf({ cloud: 'bedrock', way: 'keys', accessKeyId: 'AKIAFAKE', secretAccessKey: 's', sessionToken: ' ', region: 'eu-west-1' }),
    ).toEqual({ cloud: 'bedrock', region: 'eu-west-1', auth: { way: 'keys', accessKeyId: 'AKIAFAKE', secretAccessKey: 's' } })
    expect(cloudConnectionOf({ cloud: 'bedrock', way: 'environment', profile: 'ignored' })).toEqual({ cloud: 'bedrock', auth: { way: 'environment' } })
  })

  it('refuses an unknown cloud or way and a missing field', () => {
    expect(codeOf(() => cloudConnectionOf({ cloud: 'elsewhere', way: 'environment' }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'bedrock', way: 'password' }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'bedrock', way: 'apiKey', key: '  ' }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'bedrock', way: 'keys', accessKeyId: 'AKIAFAKE' }))).toBe('request.required')
  })

  it('refuses a value with a space inside, as a pasted key with a line break would be', () => {
    expect(codeOf(() => cloudConnectionOf({ cloud: 'bedrock', way: 'apiKey', key: 'ABSK fake' }))).toBe('account.cloudFieldInvalid')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'bedrock', way: 'environment', region: 'eu central' }))).toBe('account.cloudFieldInvalid')
  })
})

describe('Vertex AI', () => {
  it('writes the project, the region, the key file and the regions of models', () => {
    expect(
      cloudEnv({
        cloud: 'vertex',
        projectId: 'fake-project',
        region: 'global',
        auth: { way: 'keyFile', keyFile: 'C:\\Users\\John Doe\\key.json' },
        models: { sonnet: 'claude-sonnet-fake@20990101' },
        modelRegions: { VERTEX_REGION_CLAUDE_HAIKU_4_5: 'us-east5' },
      }),
    ).toEqual({
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'fake-project',
      CLOUD_ML_REGION: 'global',
      GOOGLE_APPLICATION_CREDENTIALS: 'C:\\Users\\John Doe\\key.json',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-fake@20990101',
      VERTEX_REGION_CLAUDE_HAIKU_4_5: 'us-east5',
    })
  })

  it('stores nothing of the credentials for ADC and the service environment', () => {
    for (const way of ['adc', 'environment'] as const) {
      expect(cloudEnv({ cloud: 'vertex', projectId: 'fake-project', auth: { way } })).toEqual({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'fake-project' })
    }
  })

  it('reads the connection back, short-lived for user credentials', () => {
    const env = cloudEnv({ cloud: 'vertex', projectId: 'fake-project', region: 'eu', auth: { way: 'keyFile', keyFile: '/keys/sa.json' }, modelRegions: { VERTEX_REGION_CLAUDE_4_5_OPUS: 'europe-west1' } })
    expect(cloudOf(env)).toEqual({ cloud: 'vertex', region: 'eu', way: 'keyFile', project: 'fake-project', models: {}, shortLived: false })
    expect(cloudOf({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'p' })?.way).toBe('adc')
    const userCredentials = (file: string | null) => file === null
    expect(cloudOf({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'p' }, undefined, userCredentials)?.shortLived).toBe(true)
    expect(cloudOf(env, undefined, userCredentials)?.shortLived).toBe(false)
  })

  it('takes the project, the way and the regions of models from a request', () => {
    expect(
      cloudConnectionOf({
        cloud: 'vertex',
        way: 'keyFile',
        keyFile: ' /home/john doe/key.json ',
        projectId: ' fake-project ',
        region: '',
        models: { opus: '' },
        modelRegions: { VERTEX_REGION_CLAUDE_HAIKU_4_5: ' us-east5 ', VERTEX_REGION_CLAUDE_4_5_OPUS: '' },
      }),
    ).toEqual({ cloud: 'vertex', projectId: 'fake-project', auth: { way: 'keyFile', keyFile: '/home/john doe/key.json' }, modelRegions: { VERTEX_REGION_CLAUDE_HAIKU_4_5: 'us-east5' } })
    expect(cloudConnectionOf({ cloud: 'vertex', way: 'adc', projectId: 'p', keyFile: 'ignored' })).toEqual({ cloud: 'vertex', projectId: 'p', auth: { way: 'adc' } })
  })

  it('refuses a request without a project, a key file or with an unknown variable', () => {
    expect(codeOf(() => cloudConnectionOf({ cloud: 'vertex', way: 'adc' }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'vertex', way: 'profile', projectId: 'p' }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'vertex', way: 'keyFile', projectId: 'p' }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'vertex', way: 'keyFile', projectId: 'p', keyFile: 'a\nb' }))).toBe('account.cloudFieldInvalid')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'vertex', way: 'adc', projectId: 'p', modelRegions: { PATH: 'x' } }))).toBe('account.cloudFieldInvalid')
  })
})

describe('foundryEndpointOf (BTN-824)', () => {
  it('takes a bare resource name', () => {
    expect(foundryEndpointOf(' my-resource ')).toEqual({ resource: 'my-resource' })
    expect(foundryEndpointOf('ab')).toEqual({ resource: 'ab' })
  })

  it('takes the full address of a Foundry host and keeps it to the origin and /anthropic', () => {
    expect(foundryEndpointOf('https://my-resource.services.ai.azure.com/anthropic/')).toEqual({ baseUrl: 'https://my-resource.services.ai.azure.com/anthropic' })
    expect(foundryEndpointOf('https://my-resource.openai.azure.us/anthropic')).toEqual({ baseUrl: 'https://my-resource.openai.azure.us/anthropic' })
  })

  it.each([
    ['my-resource.services.ai.azure.com', 'host'],
    ['my-resource.services.ai.azure.com/anthropic', 'host'],
    ['http://my-resource.services.ai.azure.com/anthropic', 'http'],
    ['https://gateway.example.com/anthropic', 'foreign'],
    ['https://my-resource.services.ai.azure.com', 'path'],
    ['https://my-resource.services.ai.azure.com/anthropic/v1/messages', 'path'],
    ['https://my-resource.services.ai.azure.com/anthropic?x=1', 'path'],
    ['-resource', 'name'],
    ['my resource', 'name'],
    ['', 'name'],
  ])('%s → %s', (value, problem) => {
    expect(foundryEndpointOf(value)).toEqual({ problem })
  })
})

describe('Microsoft Foundry (BTN-824)', () => {
  it('writes the resource, the key and the deployments', () => {
    expect(cloudEnv({ cloud: 'foundry', endpoint: { resource: 'my-resource' }, auth: { way: 'apiKey', key: 'fake-key' }, models: { sonnet: 'my-sonnet', haiku: 'my-haiku' } })).toEqual({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_RESOURCE: 'my-resource',
      ANTHROPIC_FOUNDRY_API_KEY: 'fake-key',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'my-sonnet',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'my-haiku',
    })
  })

  it('writes the address instead of the name, a token, and nothing of the credentials for Entra ID', () => {
    const baseUrl = 'https://my-resource.services.ai.azure.com/anthropic'
    expect(cloudEnv({ cloud: 'foundry', endpoint: { baseUrl }, auth: { way: 'token', token: 'fake-token' }, models: { opus: 'my-opus' } })).toEqual({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_BASE_URL: baseUrl,
      ANTHROPIC_FOUNDRY_AUTH_TOKEN: 'fake-token',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'my-opus',
    })
    expect(cloudEnv({ cloud: 'foundry', endpoint: { resource: 'r1' }, auth: { way: 'entra' }, models: { opus: 'o' } })).toEqual({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_RESOURCE: 'r1',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'o',
    })
  })

  it('reads the connection back in the CLI’s order of ways, short-lived for a token', () => {
    const env = { CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_RESOURCE: 'my-resource', ANTHROPIC_FOUNDRY_API_KEY: 'k', ANTHROPIC_DEFAULT_SONNET_MODEL: 'my-sonnet' }
    expect(cloudOf(env)).toEqual({ cloud: 'foundry', region: null, way: 'apiKey', resource: 'my-resource', models: { sonnet: 'my-sonnet' }, shortLived: false })
    expect(cloudOf({ ...env, ANTHROPIC_FOUNDRY_AUTH_TOKEN: 't' })).toMatchObject({ way: 'token', shortLived: true })
    expect(cloudOf({ CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_RESOURCE: 'r1' })?.way).toBe('entra')
    expect(cloudOf({ CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_BASE_URL: 'https://my-resource.services.ai.azure.com/anthropic' })?.resource).toBe('my-resource.services.ai.azure.com')
  })

  it('takes the way, the endpoint and the deployments from a request', () => {
    expect(cloudConnectionOf({ cloud: 'foundry', way: 'apiKey', key: ' fake-key ', resource: ' my-resource ', models: { sonnet: ' my-sonnet ', opus: '' } })).toEqual({
      cloud: 'foundry',
      endpoint: { resource: 'my-resource' },
      auth: { way: 'apiKey', key: 'fake-key' },
      models: { sonnet: 'my-sonnet' },
    })
    expect(cloudConnectionOf({ cloud: 'foundry', way: 'entra', key: 'ignored', resource: 'https://r1.services.ai.azure.com/anthropic', models: { haiku: 'h' } })).toEqual({
      cloud: 'foundry',
      endpoint: { baseUrl: 'https://r1.services.ai.azure.com/anthropic' },
      auth: { way: 'entra' },
      models: { haiku: 'h' },
    })
  })

  it('refuses a request without a resource, a key or a token, with an address for a name, or without a deployment', () => {
    const models = { sonnet: 'my-sonnet' }
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'adc', resource: 'r1', models }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'entra', models }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'apiKey', resource: 'r1', models }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'token', resource: 'r1', models }))).toBe('request.required')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'entra', resource: 'r1.services.ai.azure.com', models }))).toBe('account.foundryEndpoint')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'entra', resource: 'r1' }))).toBe('account.foundryModels')
    expect(codeOf(() => cloudConnectionOf({ cloud: 'foundry', way: 'entra', resource: 'r1', models: { opus: ' ' } }))).toBe('account.foundryModels')
  })
})

describe('isCloudVariable', () => {
  it('knows every cloud’s variables and any region of a model', () => {
    expect(isCloudVariable('CLAUDE_CODE_USE_FOUNDRY')).toBe(true)
    expect(isCloudVariable('ANTHROPIC_FOUNDRY_API_KEY')).toBe(true)
    expect(isCloudVariable('CLAUDE_CODE_USE_VERTEX')).toBe(true)
    expect(isCloudVariable('AWS_PROFILE')).toBe(true)
    expect(isCloudVariable('GOOGLE_APPLICATION_CREDENTIALS')).toBe(true)
    expect(isCloudVariable('VERTEX_REGION_CLAUDE_FUTURE_9')).toBe(true)
    expect(isCloudVariable('ANTHROPIC_API_KEY')).toBe(false)
  })
})
