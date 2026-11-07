import { describe, expect, it } from 'vitest'
import { cloudConnectionOf } from '../../src/account/cloud.js'
import { cloudBody, cloudDirty, cloudReady, cloudShortLived, EMPTY_CLOUD, withCloud } from './cloudDraft.js'

const aws = { profiles: [{ name: 'work', region: null, shortLived: false }, { name: 'sso-dev', region: null, shortLived: true }], user: 'john', home: '/home/john' }
const gcloud = { user: 'john', home: '/home/john', adcFile: '/home/john/.config/gcloud/application_default_credentials.json', adcType: 'authorized_user', environmentFile: null, projects: ['fake-project'] }
const vertex = withCloud(EMPTY_CLOUD, 'vertex')

describe('withCloud', () => {
  it("switches to the other cloud's first way and keeps what is typed", () => {
    expect(vertex).toMatchObject({ cloud: 'vertex', way: 'adc' })
    expect(withCloud({ ...vertex, way: 'keyFile', region: 'global' }, 'bedrock')).toMatchObject({ cloud: 'bedrock', way: 'profile', region: 'global' })
  })
})

describe('cloudReady', () => {
  it('needs the fields of the picked way only', () => {
    expect(cloudReady(EMPTY_CLOUD)).toBe(false)
    expect(cloudReady({ ...EMPTY_CLOUD, profile: 'work' })).toBe(true)
    expect(cloudReady({ ...EMPTY_CLOUD, way: 'keys', accessKeyId: 'AKIAFAKE' })).toBe(false)
    expect(cloudReady({ ...EMPTY_CLOUD, way: 'keys', accessKeyId: 'AKIAFAKE', secretAccessKey: 's' })).toBe(true)
    expect(cloudReady({ ...EMPTY_CLOUD, way: 'environment' })).toBe(true)
  })

  it('needs the project of a Vertex account, and the key file for its way', () => {
    expect(cloudReady(vertex)).toBe(false)
    expect(cloudReady({ ...vertex, projectId: 'fake-project' })).toBe(true)
    expect(cloudReady({ ...vertex, projectId: 'fake-project', way: 'keyFile' })).toBe(false)
    expect(cloudReady({ ...vertex, projectId: 'fake-project', way: 'keyFile', keyFile: '/keys/sa.json' })).toBe(true)
  })
})

describe('cloudBody', () => {
  it('sends no secret of another way, and the server reads it back as the form meant', () => {
    const draft = { ...EMPTY_CLOUD, way: 'apiKey' as const, key: 'ABSKfake', profile: 'typed before', secretAccessKey: 'typed before', region: 'eu-west-1', sonnet: 'eu.anthropic.fake' }
    const body = cloudBody('AWS', draft)
    expect(body).not.toHaveProperty('profile')
    expect(body).not.toHaveProperty('secretAccessKey')
    expect(cloudConnectionOf(body)).toEqual({ cloud: 'bedrock', region: 'eu-west-1', auth: { way: 'apiKey', key: 'ABSKfake' }, models: { sonnet: 'eu.anthropic.fake' } })
  })

  it('sends a Vertex account without the AWS fields, its model regions by variable, and the server reads it back', () => {
    const draft = {
      ...vertex,
      way: 'keyFile' as const,
      keyFile: 'C:\keys\John Doe\sa.json',
      projectId: 'fake-project',
      region: 'global',
      profile: 'typed before',
      sonnet: 'claude-sonnet-4-5@20250929',
      modelRegions: [
        { variable: 'VERTEX_REGION_CLAUDE_HAIKU_4_5', region: 'us-east5' },
        { variable: 'VERTEX_REGION_CLAUDE_4_1_OPUS', region: ' ' },
      ],
    }
    const body = cloudBody('Vertex', draft)
    expect(body).not.toHaveProperty('profile')
    expect(body).not.toHaveProperty('regionPrefix')
    expect(cloudConnectionOf(body)).toEqual({
      cloud: 'vertex',
      projectId: 'fake-project',
      region: 'global',
      auth: { way: 'keyFile', keyFile: 'C:\keys\John Doe\sa.json' },
      models: { sonnet: 'claude-sonnet-4-5@20250929' },
      modelRegions: { VERTEX_REGION_CLAUDE_HAIKU_4_5: 'us-east5' },
    })
    expect(cloudBody('Vertex', { ...draft, way: 'adc' })).not.toHaveProperty('keyFile')
  })
})

describe('cloudShortLived', () => {
  it('warns of an SSO profile, a short-term key and a session token', () => {
    expect(cloudShortLived({ ...EMPTY_CLOUD, profile: 'sso-dev' }, aws)).toBe(true)
    expect(cloudShortLived({ ...EMPTY_CLOUD, profile: 'work' }, aws)).toBe(false)
    expect(cloudShortLived({ ...EMPTY_CLOUD, profile: 'sso-dev' }, undefined)).toBe(false)
    expect(cloudShortLived({ ...EMPTY_CLOUD, way: 'apiKey', key: 'bedrock-api-key-fake' }, aws)).toBe(true)
    expect(cloudShortLived({ ...EMPTY_CLOUD, way: 'apiKey', key: 'ABSKfake' }, aws)).toBe(false)
    expect(cloudShortLived({ ...EMPTY_CLOUD, way: 'keys', accessKeyId: 'A', secretAccessKey: 's', sessionToken: 't' }, aws)).toBe(true)
  })

  it("warns of a user's ADC sign-in, not of a key file or the service's own key", () => {
    expect(cloudShortLived(vertex, undefined, gcloud)).toBe(true)
    expect(cloudShortLived(vertex, undefined, undefined)).toBe(false)
    expect(cloudShortLived(vertex, undefined, { ...gcloud, adcType: 'service_account' })).toBe(false)
    expect(cloudShortLived({ ...vertex, way: 'environment' }, undefined, gcloud)).toBe(true)
    expect(cloudShortLived({ ...vertex, way: 'environment' }, undefined, { ...gcloud, environmentFile: '/keys/sa.json' })).toBe(false)
    expect(cloudShortLived({ ...vertex, way: 'keyFile', keyFile: '/keys/sa.json' }, undefined, gcloud)).toBe(false)
  })
})

describe('cloudDirty', () => {
  it('counts a typed secret or model, not a picked profile or region', () => {
    expect(cloudDirty(undefined)).toBe(false)
    expect(cloudDirty({ ...EMPTY_CLOUD, profile: 'work', region: 'eu-west-1' })).toBe(false)
    expect(cloudDirty({ ...EMPTY_CLOUD, secretAccessKey: 's' })).toBe(true)
    expect(cloudDirty({ ...vertex, keyFile: '/keys/sa.json' })).toBe(true)
    expect(cloudDirty({ ...vertex, modelRegions: [{ variable: 'VERTEX_REGION_CLAUDE_HAIKU_4_5', region: 'us-east5' }] })).toBe(true)
  })
})
