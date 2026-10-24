import { describe, expect, it } from 'vitest'
import type { SecretView } from '../../../src/state.js'
import { classifierChanges, classifierDraft } from './classifier.js'

const variable = (name: string, value: string | null, extra: Partial<SecretView> = {}): SecretView => ({
  name,
  secret: name === 'TALLY_LLM_KEY',
  places: ['env'],
  readers: { tally: true, page: false },
  set: value !== null,
  value: name === 'TALLY_LLM_KEY' ? null : value,
  outer: false,
  sessions: null,
  required: false,
  ...extra,
})

const saved = [variable('TALLY_LLM_URL', 'https://llm.example.com'), variable('TALLY_LLM_KEY', 'key'), variable('TALLY_LLM_MODEL', null)]

describe('classifierDraft', () => {
  it('starts from the saved address and model, the key blank', () => {
    expect(classifierDraft(saved)).toEqual({ url: 'https://llm.example.com', key: '', model: '' })
  })
})

describe('classifierChanges', () => {
  it('is empty while nothing changed, a blank key keeping the saved one', () => {
    expect(classifierChanges(saved, { url: ' https://llm.example.com ', key: '', model: '' })).toEqual({})
  })

  it('sends a changed field, a new key, and null for a cleared one that was set', () => {
    expect(classifierChanges(saved, { url: '', key: 'new-key', model: 'small' })).toEqual({ TALLY_LLM_URL: null, TALLY_LLM_KEY: 'new-key', TALLY_LLM_MODEL: 'small' })
  })

  it('leaves out a variable from the service environment', () => {
    const outer = [variable('TALLY_LLM_URL', 'https://llm.example.com', { outer: true }), ...saved.slice(1)]
    expect(classifierChanges(outer, { url: 'https://other.example.com', key: '', model: 'small' })).toEqual({ TALLY_LLM_MODEL: 'small' })
  })
})
