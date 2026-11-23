import { describe, expect, it } from 'vitest'
import type { ProfileSet, TrackerProfile } from '../profiles/model.js'
import { hulyProfilesOf } from './huly-profiles.js'

const HULY = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'one' }
const OTHER = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'two' }

function profile(id: string, values: Record<string, string>, extra: Partial<TrackerProfile> = {}): TrackerProfile {
  return { id, kind: 'huly', name: id, values, isDefault: false, login: null, expiresAt: null, ...extra }
}

const config = {
  keys: { 'p-abc': 'ABC', 'p-gh': 'GH' },
  trackers: { 'p-abc': 'huly', 'p-gh': 'github' },
  trackerProjects: {},
}

describe('hulyProfilesOf', () => {
  it('gives each Huly project its profile, the default as the fallback and every profile by id', () => {
    const set: ProfileSet = { profiles: [profile('h1', HULY, { isDefault: true }), profile('h2', OTHER)], links: {} }
    expect(hulyProfilesOf(config, set)).toEqual({
      projects: { ABC: HULY },
      fallback: HULY,
      elsewhere: ['GH'],
      prefixes: ['ABC', 'GH'],
      byId: { h1: HULY, h2: OTHER },
    })
  })

  it('leaves a turned-off profile out everywhere: Tally reaches nothing of its host', () => {
    const set: ProfileSet = { profiles: [profile('h1', HULY, { isDefault: true, disabled: true }), profile('h2', OTHER)], links: { 'p-abc': 'h1' } }
    const huly = hulyProfilesOf(config, set)
    expect(huly.projects).toEqual({})
    expect(huly.fallback).toBeNull()
    expect(huly.byId).toEqual({ h2: OTHER })
  })
})
