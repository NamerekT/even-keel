import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatTitles, titleOf } from './title.js'

const line = (entry: Record<string, unknown>) => JSON.stringify(entry)

describe('titleOf', () => {
  it('takes the last title the CLI wrote', () => {
    const text = [
      line({ type: 'ai-title', aiTitle: 'First guess', sessionId: 's' }),
      line({ type: 'user', message: { content: 'hi' } }),
      line({ type: 'ai-title', aiTitle: 'Account profiles per project', sessionId: 's' }),
    ].join('\n')
    expect(titleOf(text)).toBe('Account profiles per project')
  })

  it('prefers the name the user gave over the generated one', () => {
    const text = [
      line({ type: 'custom-title', customTitle: 'Release notes', sessionId: 's' }),
      line({ type: 'ai-title', aiTitle: 'Writing the changelog', sessionId: 's' }),
    ].join('\n')
    expect(titleOf(text)).toBe('Release notes')
  })

  it('skips a cut first line, broken lines and blank titles', () => {
    const text = ['tle","aiTitle":"Cut"}', '{not json', line({ type: 'ai-title', aiTitle: '  ' }), line({ type: 'ai-title', aiTitle: ' Kept ' })].join('\n')
    expect(titleOf(text)).toBe('Kept')
  })

  it('is not the name the session was launched under, which the CLI writes as its custom title', () => {
    const named = line({ type: 'custom-title', customTitle: 'chat-3736a7bc4660', sessionId: 's' })
    expect(titleOf([named, named].join('\n'), 'chat-3736a7bc4660')).toBeNull()
    expect(titleOf([named, line({ type: 'ai-title', aiTitle: 'Slow build' })].join('\n'), 'chat-3736a7bc4660')).toBe('Slow build')
  })

  it('keeps a rename by the user over the launch name', () => {
    const text = [
      line({ type: 'custom-title', customTitle: 'chat-3736a7bc4660' }),
      line({ type: 'custom-title', customTitle: 'Release notes' }),
      line({ type: 'custom-title', customTitle: 'chat-3736a7bc4660' }),
    ].join('\n')
    expect(titleOf(text, 'chat-3736a7bc4660')).toBe('Release notes')
  })

  it('has no title before the CLI writes one', () => {
    expect(titleOf(line({ type: 'user', message: { content: 'hi' } }))).toBeNull()
  })
})

describe('ChatTitles', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const transcript = (sessionId: string) => {
    dir = mkdtempSync(join(tmpdir(), 'titles-'))
    mkdirSync(join(dir, 'D--Projects-example'))
    return join(dir, 'D--Projects-example', `${sessionId}.jsonl`)
  }

  it('finds the transcript under any project folder and rereads it only once it grows', async () => {
    const file = transcript('11111111-2222')
    writeFileSync(file, `${line({ type: 'ai-title', aiTitle: 'Fixing the header' })}\n`)
    const titles = new ChatTitles(64)
    expect(await titles.of(dir, '11111111-2222')).toBe('Fixing the header')
    appendFileSync(file, `${line({ type: 'custom-title', customTitle: 'Header' })}\n`)
    expect(await titles.of(dir, '11111111-2222')).toBe('Header')
  })

  it('keeps the known title when the tail it reads no longer holds one', async () => {
    const file = transcript('33333333-4444')
    writeFileSync(file, `${line({ type: 'ai-title', aiTitle: 'Long chat' })}\n`)
    const titles = new ChatTitles(64)
    expect(await titles.of(dir, '33333333-4444')).toBe('Long chat')
    appendFileSync(file, `${line({ type: 'user', message: { content: 'x'.repeat(200) } })}\n`)
    expect(await titles.of(dir, '33333333-4444')).toBe('Long chat')
  })

  it('passes over the launch name it is given', async () => {
    const file = transcript('99999999-0000')
    writeFileSync(file, `${line({ type: 'custom-title', customTitle: 'chat-be452f139759' })}\n`)
    expect(await new ChatTitles().of(dir, '99999999-0000', 'chat-be452f139759')).toBeNull()
  })

  it('has no title without a transcript', async () => {
    transcript('55555555-6666')
    expect(await new ChatTitles().of(dir, '77777777-8888')).toBeNull()
  })
})
