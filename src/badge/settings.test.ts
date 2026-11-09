import { describe, expect, it } from 'vitest'
import { BADGE_FIELDS } from './model.js'
import { badgePushes, badgeSettingsOf } from './settings.js'

describe('badgeSettingsOf', () => {
  it('reads null as no badge and fills every field until some are picked, in their own order', () => {
    expect(badgeSettingsOf(null, 'ABC.badge')).toBeNull()
    expect(badgeSettingsOf({ on: true, url: ' https://badge.example.com ', slug: ' Example ' }, 'ABC.badge')).toEqual({ on: true, url: 'https://badge.example.com', slug: 'example', fields: [...BADGE_FIELDS] })
    expect(badgeSettingsOf({ on: false, url: '', slug: '', fields: ['chain', 'title'] }, 'ABC.badge')).toEqual({ on: false, url: '', slug: '', fields: ['title', 'chain'] })
  })

  it('refuses a bad shape, address, slug or field with config.badge', () => {
    for (const value of [
      'on',
      [],
      { on: 'yes', url: '', slug: '' },
      { on: true, url: 'ftp://example.com', slug: 'a' },
      { on: true, url: 'not a url', slug: 'a' },
      { on: true, url: 'https://example.com', slug: 'a b' },
      { on: true, url: 'https://example.com', slug: '-a' },
      { on: true, url: 'https://example.com', slug: 'a', fields: ['title', 'question'] },
      { on: true, url: 'https://example.com', slug: 'a', fields: 'title' },
    ]) {
      expect(() => badgeSettingsOf(value, 'ABC.badge')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.badge' }) }))
    }
  })
})

describe('badgePushes', () => {
  it('pushes only a badge that is on and says where to', () => {
    const on = { on: true, url: 'https://badge.example.com', slug: 'example', fields: [] }
    expect(badgePushes(on)).toBe(true)
    expect(badgePushes({ ...on, on: false })).toBe(false)
    expect(badgePushes({ ...on, url: '' })).toBe(false)
    expect(badgePushes({ ...on, slug: '' })).toBe(false)
    expect(badgePushes(null)).toBe(false)
    expect(badgePushes(undefined)).toBe(false)
  })
})
