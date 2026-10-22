import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Backlog, turnAfter } from './executor.js'

describe('turnAfter', () => {
  it('starts a turn with a user message going in and ends it with a result coming out', () => {
    expect(turnAfter('idle', '{"type":"user","message":{"role":"user","content":"Go"}}', 'host')).toBe('busy')
    expect(turnAfter('busy', '{"type":"result","subtype":"success"}', 'cli')).toBe('idle')
  })

  it('takes an assistant message for a running turn: a queued message may start one without a line going in', () => {
    expect(turnAfter('idle', '{"type":"assistant","message":{}}', 'cli')).toBe('busy')
  })

  it('keeps the turn on control lines, the other messages and lines that are not JSON', () => {
    expect(turnAfter('idle', '{"type":"control_request","request":{"subtype":"initialize"}}', 'host')).toBe('idle')
    expect(turnAfter('busy', '{"type":"control_response"}', 'host')).toBe('busy')
    expect(turnAfter('busy', '{"type":"system","subtype":"init"}', 'cli')).toBe('busy')
    expect(turnAfter('busy', 'not json', 'cli')).toBe('busy')
    expect(turnAfter('idle', '{"type":"user"', 'host')).toBe('idle')
  })
})

describe('Backlog', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })
  const file = () => join((dir = mkdtempSync(join(tmpdir(), 'even-keel-backlog-'))), 'spill.jsonl')

  it('gives the lines back in order and is empty afterwards', () => {
    const backlog = new Backlog(file(), 100)
    backlog.push('one')
    backlog.push('two')
    expect(backlog.drain()).toEqual(['one', 'two'])
    expect(backlog.drain()).toEqual([])
  })

  it('moves everything into the file past the memory bound and keeps the order', () => {
    const backlog = new Backlog(file(), 8)
    for (const line of ['aaaa', 'bbbb', 'cccc', 'dddd']) backlog.push(line)
    expect(backlog.drain()).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd'])
    backlog.push('eeee')
    expect(backlog.drain()).toEqual(['eeee'])
  })

  it('drops what goes past the bound of the file', () => {
    const backlog = new Backlog(file(), 4, 10)
    for (const line of ['aaaa', 'bbbb', 'cccc']) backlog.push(line)
    expect(backlog.drain()).toEqual(['aaaa', 'bbbb'])
  })
})
