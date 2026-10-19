import { describe, expect, it } from 'vitest'
import { huly } from './adapter.js'
import { ALTERNATIVES, authOf, issueUrlBase, readHulyCredentials } from './credentials.js'

const full = {
  HULY_URL: 'https://huly.example.com',
  HULY_WORKSPACE: 'example',
  HULY_EMAIL: 'john.doe@example.com',
  HULY_PASSWORD: 'not-a-real-password',
}

describe('the Huly profile dialog', () => {
  it('offers the e-mail and the password first: released Huly has no API tokens page', () => {
    expect(ALTERNATIVES[0]).toEqual(['HULY_EMAIL', 'HULY_PASSWORD'])
  })

  it("points to the plugin README's credentials section for help", () => {
    expect(huly.help).toBe('https://github.com/NamerekT/even-keel/blob/main/plugins/huly/README.md#credentials')
  })
})

describe('readHulyCredentials', () => {
  it('reads the address, the workspace, the e-mail and the password', () => {
    expect(readHulyCredentials(full)).toEqual({
      url: 'https://huly.example.com',
      workspace: 'example',
      token: null,
      email: 'john.doe@example.com',
      password: 'not-a-real-password',
    })
  })

  it('takes a token in place of the e-mail and the password, and prefers it over them', () => {
    const token = { HULY_URL: full.HULY_URL, HULY_WORKSPACE: 'example', HULY_TOKEN: 'example-token' }
    expect(readHulyCredentials(token)).toMatchObject({ token: 'example-token', email: null, password: null })
    expect(readHulyCredentials({ ...full, HULY_TOKEN: 'example-token' })).toMatchObject({ token: 'example-token', email: null, password: null })
  })

  it('returns undefined when Huly is not configured at all', () => {
    expect(readHulyCredentials({})).toBeUndefined()
  })

  it('names every missing variable when the set is incomplete', () => {
    expect(() => readHulyCredentials({ HULY_URL: full.HULY_URL, HULY_EMAIL: '' })).toThrow(/^set HULY_WORKSPACE, HULY_EMAIL, HULY_PASSWORD \(or HULY_TOKEN\)/)
    expect(() => readHulyCredentials({ HULY_URL: full.HULY_URL, HULY_TOKEN: 'example-token' })).toThrow(/^set HULY_WORKSPACE, or none/)
  })
})

describe('authOf', () => {
  it('signs in with the token when there is one, else with the e-mail and the password', () => {
    expect(authOf({ url: '', workspace: 'example', token: 'example-token', email: null, password: null })).toEqual({ token: 'example-token', workspace: 'example' })
    expect(authOf(readHulyCredentials(full)!)).toEqual({ email: 'john.doe@example.com', password: 'not-a-real-password', workspace: 'example' })
  })
})

describe('issueUrlBase', () => {
  const credentials = { url: 'https://huly.example.com', workspace: 'example' }

  it('points at the tracker of the workspace so an issue key completes the link', () => {
    expect(issueUrlBase(credentials)).toBe('https://huly.example.com/workbench/example/tracker/')
  })

  it('drops a trailing slash of the server address and escapes the workspace', () => {
    expect(issueUrlBase({ ...credentials, url: 'https://huly.example.com/', workspace: 'my space' })).toBe(
      'https://huly.example.com/workbench/my%20space/tracker/',
    )
  })
})
