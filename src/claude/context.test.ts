import { describe, expect, it } from 'vitest'
import { contextArgs, parseContextWindow } from './context.js'

const answer = (result: string) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 0, local_command: 'context', result })
const usage = (tokens: string) =>
  `## Context Usage\n\n**Model:** claude-opus-5-5  \n**Tokens:** ${tokens}\n\n### Estimated usage by category\n\n| Category | Tokens | Percentage |\n|----------|--------|------------|\n| Free space | 193.2k | 77.3% |\n`

describe('parseContextWindow', () => {
  it("takes the window from the tokens line of `/context`'s answer", () => {
    expect(parseContextWindow(answer(usage('23.8k / 250k (10%)')))).toBe(250_000)
    expect(parseContextWindow(answer(usage('25.2k / 400k (6%)')))).toBe(400_000)
    expect(parseContextWindow(answer(usage('31k / 1M (3%)')))).toBe(1_000_000)
    expect(parseContextWindow(answer(usage('31k / 1.5m (2%)')))).toBe(1_500_000)
    expect(parseContextWindow(answer(usage('900 / 200000 (0%)')))).toBe(200_000)
  })

  it('finds none in an answer without the line, an error, or what is not JSON', () => {
    expect(parseContextWindow(answer('## Context Usage\n\nNo data.'))).toBeNull()
    expect(parseContextWindow(JSON.stringify({ type: 'result', is_error: true, result: usage('23.8k / 250k (10%)') }))).toBeNull()
    expect(parseContextWindow(answer(usage('23.8k / 0 (0%)')))).toBeNull()
    expect(parseContextWindow('not json')).toBeNull()
  })
})

describe('contextArgs', () => {
  it('asks for the model and the settings of a chain session and leaves no session behind', () => {
    expect(contextArgs('opus[1m]', '{"promptCacheTtl":"1h"}')).toEqual([
      '-p',
      '/context',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--model',
      'opus[1m]',
      '--settings',
      '{"promptCacheTtl":"1h"}',
    ])
    expect(contextArgs('haiku')).toEqual(['-p', '/context', '--output-format', 'json', '--no-session-persistence', '--model', 'haiku'])
  })
})
