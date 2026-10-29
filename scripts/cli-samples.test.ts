import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { anonymizeSample, compareSamples, saveSample, type CliSample } from './cli-samples.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('CLI transcript samples', () => {
  it('removes identities and secrets from nested JSON, commands and references without changing event fields', () => {
    const privateValues = ['C:\\Users\\SampleUser\\private', '/home/sample-user/project', 'sample-person@invalid.test',
      'original-session-7', 'WORKSTATION-TEST', 'sample-account-token-value', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzYW1wbGUifQ.signature', 'Sample Person']
    const raw = {
      type: 'session_meta', sessionId: privateValues[3], hostname: privateValues[4], author: { name: privateValues[8], email: privateValues[2] },
      payload: { cwd: privateValues[0], token: privateValues[5], command: `cd '${privateValues[1]}' && echo ${privateValues[3]}` },
      data: JSON.stringify({ path: `${privateValues[0]}\\answer.txt`, content: `Bearer ${privateValues[6]} ${privateValues[7]}` }),
    }
    const clean = anonymizeSample(raw)
    const text = JSON.stringify(clean)
    for (const value of privateValues) expect(text).not.toContain(value)
    const strings = (item: unknown): string[] => {
      if (typeof item === 'string') {
        try { const parsed = JSON.parse(item); return [item, ...(typeof parsed === 'object' ? strings(parsed) : [])] } catch { return [item] }
      }
      return item !== null && typeof item === 'object' ? Object.entries(item).flatMap(([key, value]) => [key, ...strings(value)]) : []
    }
    for (const actual of strings(clean)) for (const value of privateValues) expect(actual).not.toContain(value)
    expect(clean.type).toBe('session_meta')
    expect(Object.keys(clean)).toEqual(Object.keys(raw))
    expect(JSON.parse(clean.data).path).toContain('answer.txt')
    expect(clean.payload.command).toContain(clean.sessionId)
  })

  it('redacts JSONL, UNC paths, URL credentials and known machine/user strings in free text', () => {
    const clean = anonymizeSample({ jsonl: JSON.stringify({ type: 'event_msg', payload: {
      text: 'user-alpha on host-alpha: \\\\server-alpha\\share\\file.txt https://user:password@private.invalid/path?token=secret',
    } }) }, ['user-alpha', 'host-alpha'])
    expect(clean.jsonl).toContain('event_msg')
    for (const value of ['user-alpha', 'host-alpha', 'server-alpha', 'private.invalid', 'password', 'secret']) expect(clean.jsonl).not.toContain(value)
    const paths = anonymizeSample({ cwd: '/srv/team/project', file: 'file:///data/private/report.txt', model: 'opencode/big-pickle' })
    expect(paths.cwd).not.toContain('/srv/team')
    expect(paths.file).not.toContain('/data/private')
    expect(paths.model).toBe('opencode/big-pickle')
  })

  it('keeps provider names, versions, tool names and token counts when an event uses short ids', () => {
    const raw = { provider: 'copilot', version: '1.0.98', tool: { name: 'Write', id: '1' }, next: { id: '0' },
      reference: '1', model: { id: 'copilot' }, tokens: { input: 10 }, tokenKind: 'input', message: 'CHECKPOINT: answer.txt' }
    const clean = anonymizeSample(raw)
    expect(clean).toMatchObject({ provider: 'copilot', version: '1.0.98', tool: { name: 'Write' }, model: { id: 'copilot' }, tokens: { input: 10 }, tokenKind: 'input', message: raw.message })
    expect(clean.reference).toBe(clean.tool.id)
    expect(anonymizeSample('User ab on box-7', ['ab', 'box-7'])).not.toMatch(/\bab\b|box-7/)
  })

  it('redacts session and email dictionary keys, including accounting watermarks inside JSON strings', () => {
    const id = '00000000-1234-4000-8000-000000000009'
    const email = 'source-person@invalid.test'
    const clean = anonymizeSample({ sessionId: id, data: JSON.stringify({ usageAccountingWatermarks: { [id]: 1 }, users: { [email]: true } }) })
    expect(JSON.stringify(clean)).not.toContain(id)
    expect(JSON.stringify(clean)).not.toContain(email)
    expect(JSON.parse(clean.data).usageAccountingWatermarks[clean.sessionId]).toBe(1)
  })

  it('preserves earlier runs, and refuses path traversal in provider/version', () => {
    mkdirSync(join(import.meta.dirname, '../.temp'), { recursive: true })
    const dir = mkdtempSync(join(import.meta.dirname, '../.temp/cli-samples-'))
    dirs.push(dir)
    const sample = { provider: 'codex', version: '0.1.0', snapshots: [] } as unknown as CliSample
    const first = saveSample(dir, sample)
    saveSample(dir, { ...sample, contextWindow: 123 })
    expect(readFileSync(first, 'utf8')).toContain('0.1.0')
    expect(readdirSync(join(dir, 'codex', '0.1.0'))).toHaveLength(2)
    expect(() => saveSample(dir, { ...sample, version: '../escape' })).toThrow()
  })

  it('compares event types and field paths, including OpenCode JSON stored in rows', () => {
    const sample = (jsonl: string): CliSample => ({ provider: 'codex', version: '0.1.0', snapshots: [{ raw: { jsonl } }] }) as CliSample
    const diff = compareSamples([sample('{"type":"old","payload":{"value":1}}\n{"type":"same","payload":{"before":1}}')],
      [sample('{"type":"new","payload":{"value":1}}\n{"type":"same","payload":{"after":1}}')])
    expect(diff.addedTypes).toEqual(['new'])
    expect(diff.removedTypes).toEqual(['old'])
    expect(diff.addedFields).toContain('same:payload.after')
    expect(diff.removedFields).toContain('same:payload.before')
    const rows = (data: string) => ({ provider: 'opencode', snapshots: [{ raw: { messages: [{ data }], parts: [] } }] }) as CliSample
    expect(compareSamples([rows('{"role":"assistant","old":1}')], [rows('{"role":"assistant","next":1}')]).addedFields).toContain('message/assistant:next')
  })
})
