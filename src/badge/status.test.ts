import { describe, expect, it } from 'vitest'
import { STATUS_ASK_MS, StatusAsks, statusAsked, statusLineIn, statusRequest, statusTextOf, withoutStatusLine } from './status.js'

describe('the status request', () => {
  it('is found again by its mark, and nowhere else', () => {
    expect(statusAsked(`mail first\n\n${statusRequest()}`)).toBe(true)
    expect(statusAsked('add one line status: …')).toBe(false)
  })

  it('asks for one line next to the next tool call, never for a tool', () => {
    expect(statusRequest()).toMatch(/status: /)
    expect(statusRequest()).toMatch(/60 characters/)
  })
})

describe('statusLineIn', () => {
  it('takes the line that starts with `status:`, the last one of the text', () => {
    expect(statusLineIn('Now the tests.\nstatus: Writing tests for the Linear scale\n')).toBe('Writing tests for the Linear scale')
    expect(statusLineIn('status: one\ntext\n  status:   two  ')).toBe('two')
  })

  it('finds none inside a sentence or without words', () => {
    expect(statusLineIn('The status: fine')).toBeNull()
    expect(statusLineIn('status:')).toBeNull()
  })

  it('leaves the rest of the text for the chat', () => {
    expect(withoutStatusLine('Now the tests.\nstatus: Writing tests\nThen the merge.')).toBe('Now the tests.\nThen the merge.')
    expect(withoutStatusLine('status: Writing tests')).toBe('')
  })
})

describe('statusTextOf', () => {
  it('flattens the line and cuts it to 60 characters', () => {
    expect(statusTextOf('Writing   tests')).toBe('Writing tests')
    const long = statusTextOf(`Writing ${'tests '.repeat(20)}`)!
    expect(long).toHaveLength(60)
    expect(long.endsWith('…')).toBe(true)
  })

  it('refuses a line that is not plain English text', () => {
    expect(statusTextOf('Пишу тесты')).toBeNull()
    expect(statusTextOf('   ')).toBeNull()
  })
})

describe('StatusAsks', () => {
  const start = Date.parse('2026-11-09T12:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()

  it('asks a session without a status at once, then no more often than every two minutes', () => {
    const asks = new StatusAsks()
    expect(asks.due('s-1', null, start)).toBe(true)
    expect(asks.due('s-1', null, start + STATUS_ASK_MS - 1)).toBe(false)
    expect(asks.due('s-1', null, start + STATUS_ASK_MS)).toBe(true)
    expect(asks.due('s-2', null, start + STATUS_ASK_MS)).toBe(true)
  })

  it('counts the two minutes from the status the session wrote', () => {
    const asks = new StatusAsks()
    expect(asks.due('s-1', null, start)).toBe(true)
    const written = start + 30_000
    expect(asks.due('s-1', { text: 'Writing tests', at: iso(written) }, start + STATUS_ASK_MS)).toBe(false)
    expect(asks.due('s-1', { text: 'Writing tests', at: iso(written) }, written + STATUS_ASK_MS)).toBe(true)
  })

  it('asks a fresh status no sooner after a restart of the service', () => {
    expect(new StatusAsks().due('s-1', { text: 'Writing tests', at: iso(start) }, start + 60_000)).toBe(false)
  })
})
