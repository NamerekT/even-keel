import { describe, expect, it } from 'vitest'
import { readHulyCredentials } from './credentials.js'

const full = {
  HULY_URL: 'https://huly.example.com',
  HULY_WORKSPACE: 'example',
  HULY_EMAIL: 'john.doe@example.com',
  HULY_PASSWORD: 'not-a-real-password',
}

describe('readHulyCredentials', () => {
  it('reads all four variables', () => {
    expect(readHulyCredentials(full)).toEqual({
      url: 'https://huly.example.com',
      workspace: 'example',
      email: 'john.doe@example.com',
      password: 'not-a-real-password',
    })
  })

  it('returns undefined when Huly is not configured at all', () => {
    expect(readHulyCredentials({})).toBeUndefined()
  })

  it('names every missing variable when the set is incomplete', () => {
    expect(() => readHulyCredentials({ HULY_URL: full.HULY_URL, HULY_EMAIL: '' })).toThrow(
      /HULY_WORKSPACE, HULY_EMAIL, HULY_PASSWORD/,
    )
  })
})
