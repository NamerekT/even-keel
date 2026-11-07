import { describe, expect, it } from 'vitest'
import { cloudConnectionOf } from '../../src/account/cloud.js'
import { cloudBody, cloudDirty, cloudReady, cloudShortLived, EMPTY_CLOUD } from './cloudDraft.js'

const aws = { profiles: [{ name: 'work', region: null, shortLived: false }, { name: 'sso-dev', region: null, shortLived: true }], user: 'john', home: '/home/john' }

describe('cloudReady', () => {
  it('needs the fields of the picked way only', () => {
    expect(cloudReady(EMPTY_CLOUD)).toBe(false)
    expect(cloudReady({ ...EMPTY_CLOUD, profile: 'work' })).toBe(true)
    expect(cloudReady({ ...EMPTY_CLOUD, way: 'keys', accessKeyId: 'AKIAFAKE' })).toBe(false)
    expect(cloudReady({ ...EMPTY_CLOUD, way: 'keys', accessKeyId: 'AKIAFAKE', secretAccessKey: 's' })).toBe(true)
    expect(cloudReady({ ...EMPTY_CLOUD, way: 'environment' })).toBe(true)
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
})

describe('cloudDirty', () => {
  it('counts a typed secret or model, not a picked profile or region', () => {
    expect(cloudDirty(undefined)).toBe(false)
    expect(cloudDirty({ ...EMPTY_CLOUD, profile: 'work', region: 'eu-west-1' })).toBe(false)
    expect(cloudDirty({ ...EMPTY_CLOUD, secretAccessKey: 's' })).toBe(true)
  })
})
