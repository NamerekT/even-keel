import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { cloudConnectionOf, cloudEnv, cloudOf } from './cloud.js'

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

  it('refuses a cloud not made yet, an unknown cloud or way and a missing field', () => {
    expect(codeOf(() => cloudConnectionOf({ cloud: 'vertex', way: 'environment' }))).toBe('account.cloudNotReady')
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
