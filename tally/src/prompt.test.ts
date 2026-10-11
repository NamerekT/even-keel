import { describe, expect, it } from 'vitest'
import type { Entry } from '../../src/sessions/entry.js'
import { firstPrompt } from './prompt.js'

const user = (content: unknown, extra: Partial<Entry> = {}): Entry => ({ type: 'user', message: { role: 'user', content }, ...extra }) as Entry

describe('firstPrompt', () => {
  it('takes the first human prompt, string or text blocks', () => {
    expect(firstPrompt([user('делай CBL-169'), user('и ещё')])).toBe('делай CBL-169')
    expect(firstPrompt([user([{ type: 'text', text: ' ABC-1 ' }])])).toBe('ABC-1')
  })

  it('drops the context blocks clients wrap around a prompt but keeps pasted text', () => {
    const blocks = [
      { type: 'text', text: '<ide_selection>The user selected CBL-157 lines</ide_selection>' },
      { type: 'text', text: 'почему тут <pasted_content id="1">CBL-160</pasted_content>' },
    ]
    expect(firstPrompt([user(blocks)])).toBe('почему тут <pasted_content id="1">CBL-160</pasted_content>')
  })

  it('skips tool results, meta rows, subagents, non-human origins and slash commands', () => {
    const entries = [
      user([{ type: 'tool_result', tool_use_id: 't', content: 'ABC-2' }]),
      user('ABC-3 caveat', { isMeta: true }),
      user('ABC-4 for the agent', { agentId: 'a1' }),
      user('ABC-5 from a hook', { origin: { kind: 'hook' } }),
      user('<command-name>/autocompact</command-name>\n<command-message>autocompact</command-message>'),
      user('<local-command-stdout>ABC-6</local-command-stdout>'),
      user('<ide_opened_file>The user opened ABC-7</ide_opened_file>'),
      user('делай ABC-8'),
    ]
    expect(firstPrompt(entries)).toBe('делай ABC-8')
  })

  it('cuts a long prompt and returns null without one', () => {
    expect(firstPrompt([user('x'.repeat(5000))])).toHaveLength(2000)
    expect(firstPrompt([user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }])])).toBeNull()
  })
})
