import { describe, expect, it } from 'vitest'
import type { ProfileKindView, ProfileView } from '../../../src/state.js'
import { alternativeOf, daysLeft, draftValues, shownFields } from './profileForm.js'

const HULY: ProfileKindView = {
  kind: 'huly',
  title: 'Huly',
  tracker: true,
  fields: [
    { name: 'HULY_URL', secret: false },
    { name: 'HULY_WORKSPACE', secret: false },
    { name: 'HULY_TOKEN', secret: true },
    { name: 'HULY_EMAIL', secret: false },
    { name: 'HULY_PASSWORD', secret: true },
  ],
  hostVariables: ['HULY_URL', 'HULY_WORKSPACE'],
  alternatives: [['HULY_TOKEN'], ['HULY_EMAIL', 'HULY_PASSWORD']],
  help: 'https://huly.example.com/help',
}

function stored(set: string[]): ProfileView {
  return {
    id: 'p-1',
    kind: 'huly',
    name: 'Huly · example',
    isDefault: true,
    fields: HULY.fields.map(({ name, secret }) => ({ name, secret, set: set.includes(name), value: null })),
    login: null,
    expiresAt: null,
    check: { state: 'ok', error: null, at: null },
    projects: [],
    ci: [],
    hiddenCi: [],
    deniedPulls: [],
  }
}

describe('alternativeOf', () => {
  it('takes the first set for a new profile', () => {
    expect(alternativeOf(HULY, undefined)).toBe(0)
  })

  it('takes the set the stored profile has filled', () => {
    expect(alternativeOf(HULY, stored(['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD']))).toBe(1)
  })
})

describe('shownFields', () => {
  it('shows the common fields and those of the chosen set only', () => {
    expect(shownFields(HULY, 1).map((field) => field.name)).toEqual(['HULY_URL', 'HULY_WORKSPACE', 'HULY_EMAIL', 'HULY_PASSWORD'])
  })

  it('shows every field of a kind without sets', () => {
    const github = { ...HULY, fields: [{ name: 'GITHUB_TOKEN', secret: true }], hostVariables: [], alternatives: [] }
    expect(shownFields(github, 0).map((field) => field.name)).toEqual(['GITHUB_TOKEN'])
  })
})

describe('draftValues', () => {
  it('sends the typed fields and drops the other set', () => {
    expect(draftValues(HULY, 0, { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'example', HULY_TOKEN: 'tok', HULY_EMAIL: 'stale' })).toEqual({
      HULY_URL: 'https://huly.example.com',
      HULY_WORKSPACE: 'example',
      HULY_TOKEN: 'tok',
      HULY_EMAIL: null,
      HULY_PASSWORD: null,
    })
  })

  it('sends a blank for a field not typed, so a stored secret stays', () => {
    expect(draftValues(HULY, 1, {}).HULY_PASSWORD).toBe('')
  })
})

describe('daysLeft', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')

  it('counts whole days up', () => {
    expect(daysLeft('2026-10-23T08:00:00Z', now)).toBe(5)
  })

  it('gives zero or less once it is past', () => {
    expect(daysLeft('2026-10-18T11:00:00Z', now)).toBeLessThanOrEqual(0)
  })
})
