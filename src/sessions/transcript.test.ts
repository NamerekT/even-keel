import { describe, expect, it } from 'vitest'
import { TranscriptFold } from './transcript.js'

const CWD = 'C:\\repos\\example-project'
let clock = 0

function at(): string {
  clock += 1000
  return new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + clock).toISOString()
}

interface Usage {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
}

function assistant(id: string, content: unknown[], usage: Usage = {}, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    timestamp: at(),
    cwd: CWD,
    message: {
      id,
      model: 'claude-opus-5-5',
      role: 'assistant',
      content,
      usage: {
        input_tokens: usage.input ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: usage.cacheWrite ?? 0,
        output_tokens: usage.output ?? 0,
      },
    },
    ...extra,
  })
}

const text = (value: string) => ({ type: 'text', text: value })
const tool = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id: `toolu_${name}`, name, input })

function apiError(error: string, message: string): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    timestamp: at(),
    isApiErrorMessage: true,
    error,
    message: { id: `err-${clock}`, model: '<synthetic>', role: 'assistant', content: [text(message)], usage: { input_tokens: 0, output_tokens: 0 } },
  })
}

function fold(lines: string[]): TranscriptFold {
  const result = new TranscriptFold()
  for (const line of lines) result.push(line)
  return result
}

describe('TranscriptFold', () => {
  it('takes the context from the last assistant answer', () => {
    const summary = fold([
      assistant('m1', [text('first')], { input: 5, cacheRead: 100, cacheWrite: 20, output: 7 }),
      assistant('m2', [text('second')], { input: 2, cacheRead: 300, cacheWrite: 40, output: 9 }),
    ]).summary()

    expect(summary.contextTokens).toBe(342)
  })

  it('counts every answer once even when it is split over several transcript lines', () => {
    const usage = { input: 2, cacheRead: 1000, cacheWrite: 50, output: 30 }
    const summary = fold([
      assistant('m1', [{ type: 'thinking', thinking: '' }], usage),
      assistant('m1', [text('looking')], usage),
      assistant('m1', [tool('Read', { file_path: `${CWD}\\src\\main.ts` })], usage),
      assistant('m2', [text('done')], { input: 1, cacheRead: 1100, cacheWrite: 10, output: 5 }),
    ]).summary()

    expect(summary.tokens).toEqual({ input: 3, output: 35, cacheRead: 2100, cacheWrite: 60 })
  })

  it('ignores sidechain answers and synthetic error messages when counting context', () => {
    const sidechain = JSON.parse(assistant('s1', [text('sub')], { input: 9999 })) as Record<string, unknown>
    sidechain.isSidechain = true
    const summary = fold([
      assistant('m1', [text('main')], { input: 10, cacheRead: 90 }),
      JSON.stringify(sidechain),
      apiError('server_error', 'API Error: 529 Overloaded.'),
    ]).summary()

    expect(summary.contextTokens).toBe(100)
    expect(summary.tokens.input).toBe(10)
  })

  it('describes the current action by the last tool call', () => {
    const summary = fold([
      assistant('m1', [text('Reading the entry point.')]),
      assistant('m2', [tool('Read', { file_path: `${CWD}\\src\\main.ts` })]),
    ]).summary()

    expect(summary.action).toMatchObject({ kind: 'tool', text: 'Read src/main.ts' })
  })

  it('falls back to the last text when it comes after the last tool call', () => {
    const summary = fold([
      assistant('m1', [tool('Bash', { command: 'npm test', description: 'Run the test suite' })]),
      assistant('m2', [text('All   tests\npass.')]),
    ]).summary()

    expect(summary.action).toMatchObject({ kind: 'text', text: 'All tests pass.' })
  })

  it('summarises tool inputs briefly', () => {
    const summary = fold([
      assistant('m1', [
        tool('Bash', { command: 'git status\ngit log', description: 'Show working tree status' }),
        tool('PowerShell', { command: 'Get-ChildItem' }),
        tool('Grep', { pattern: 'TODO', path: 'src' }),
        tool('Skill', { skill: 'huly-tracker' }),
        tool('mcp__huly__get_issue', { project: 'ABC', identifier: 'ABC-7' }),
        tool('mcp__huly__update_issue', { project: 'ABC', identifier: 'ABC-7', description: 'A long issue body' }),
        tool('Edit', { file_path: 'D:\\elsewhere\\file.ts', old_string: 'a', new_string: 'b' }),
        tool('TodoWrite', {}),
      ]),
    ]).summary()

    expect(summary.feed.map((line) => line.text)).toEqual([
      'Bash Show working tree status',
      'PowerShell Get-ChildItem',
      'Grep TODO',
      'Skill huly-tracker',
      'huly get_issue ABC-7',
      'huly update_issue ABC-7',
      'Edit D:/elsewhere/file.ts',
      'TodoWrite',
    ])
  })

  it('keeps the last 30 lines of assistant texts and tool calls', () => {
    const lines = Array.from({ length: 40 }, (_, index) => assistant(`m${index}`, [text(`step ${index}`)]))
    const summary = fold(lines).summary()

    expect(summary.feed).toHaveLength(30)
    expect(summary.feed[0]?.text).toBe('step 10')
    expect(summary.feed[29]?.text).toBe('step 39')
  })

  it('tracks the stage and does not step back to reading once editing started', () => {
    const stages = (calls: ReturnType<typeof tool>[]) =>
      fold(calls.map((call, index) => assistant(`m${index}`, [call]))).summary().stage

    expect(stages([tool('mcp__huly__get_issue', { identifier: 'ABC-1' })])).toBe('task')
    expect(stages([tool('mcp__huly__get_issue', {}), tool('Grep', { pattern: 'x' })])).toBe('recon')
    expect(stages([tool('Write', { file_path: 'a.ts' }), tool('Read', { file_path: 'b.ts' })])).toBe('edit')
    expect(stages([tool('Edit', {}), tool('Bash', { command: 'npx vitest run' })])).toBe('test')
    expect(stages([tool('Bash', { command: 'npm test' }), tool('Edit', {})])).toBe('edit')
    expect(stages([tool('Edit', {}), tool('Bash', { command: 'git add -A && git commit -m "[ABC-1] Fix"' })])).toBe('commit')
    expect(stages([tool('Bash', { command: 'git commit -m x' }), tool('Bash', { command: 'git status' })])).toBe('commit')
    expect(stages([tool('PowerShell', { command: 'git checkout main; git merge --no-edit abc-1/fix' })])).toBe('merge')
    expect(stages([tool('Agent', { subagent_type: 'runner', description: 'Run tests' })])).toBe('test')
    expect(stages([tool('Agent', { subagent_type: 'scout', description: 'Map the module' })])).toBe('recon')
  })

  it('builds the Remote Control link from the bridge session', () => {
    const summary = fold([
      JSON.stringify({ type: 'bridge-session', sessionId: 'abc', bridgeSessionId: 'cse_01Example' }),
    ]).summary()

    expect(summary.remoteUrl).toBe('https://claude.ai/code/session_01Example')
  })

  it('reports a limit hit as the last word of the session', () => {
    const summary = fold([
      assistant('m1', [text('working')]),
      apiError('rate_limit', "You've hit your session limit · resets 1:30am"),
    ]).summary()

    expect(summary.apiError).toMatchObject({ kind: 'limit', text: "You've hit your session limit · resets 1:30am" })
    expect(summary.feed.at(-1)).toMatchObject({ kind: 'error' })
  })

  it('reports other API errors and forgets them once the session answers again', () => {
    const failed = fold([assistant('m1', [text('working')]), apiError('authentication_failed', 'OAuth session expired')])
    expect(failed.summary().apiError).toMatchObject({ kind: 'error' })

    failed.push(assistant('m2', [text('back')]))
    expect(failed.summary().apiError).toBeNull()
  })

  it('remembers when the session last did something', () => {
    const summary = fold([assistant('m1', [text('a')]), assistant('m2', [text('b')])]).summary()
    expect(summary.lastActivityAt).toBe(new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + clock).toISOString())
  })

  it('follows the git branch the session is on', () => {
    const summary = fold([
      assistant('m1', [text('a')], {}, { gitBranch: 'main' }),
      JSON.stringify({ type: 'user', timestamp: at(), gitBranch: 'abc-3/panel' }),
      assistant('m2', [text('b')], {}, { gitBranch: 'abc-3/panel', isSidechain: true }),
      assistant('m3', [text('c')]),
    ]).summary()
    expect(summary.gitBranch).toBe('abc-3/panel')
    expect(fold([assistant('m1', [text('a')])]).summary().gitBranch).toBeNull()
  })

  it('remembers the last real answer apart from a limit error that came after it', () => {
    const lines = [assistant('m1', [text('a')])]
    const answeredAt = new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + clock).toISOString()
    lines.push(JSON.stringify({ type: 'user', timestamp: at() }), apiError('rate_limit', 'limit'))
    const summary = fold(lines).summary()
    expect(summary.lastReplyAt).toBe(answeredAt)
    expect(summary.lastActivityAt).not.toBe(answeredAt)
    expect(fold([apiError('rate_limit', 'limit')]).summary().lastReplyAt).toBeNull()
  })

  it('remembers when the session began', () => {
    const first = JSON.stringify({ type: 'user', timestamp: at() })
    const began = JSON.parse(first).timestamp
    const summary = fold([JSON.stringify({ type: 'queue-operation', timestamp: 'x' }), first, assistant('m1', [text('a')])]).summary()
    expect(summary.firstActivityAt).toBe(began)
  })

  it('follows the folder the session works in', () => {
    const summary = fold([
      assistant('m1', [text('a')]),
      JSON.stringify({ type: 'user', timestamp: at(), cwd: 'C:\\repos\\example-project\\.claude\\worktrees\\abc-3' }),
      assistant('m2', [text('b')], {}, { cwd: 'C:\\elsewhere', isSidechain: true }),
    ]).summary()
    expect(summary.workdir).toBe('C:\\repos\\example-project\\.claude\\worktrees\\abc-3')
    expect(fold([]).summary().workdir).toBeNull()
  })

  it('keeps a longer feed when asked to', () => {
    const lines = Array.from({ length: 50 }, (_, index) => assistant(`m${index}`, [text(`step ${index}`)]))
    const summary = fold(lines).summary()
    const long = new TranscriptFold(100)
    for (const line of lines) long.push(line)
    expect(summary.feed).toHaveLength(30)
    expect(long.summary().feed).toHaveLength(50)
  })

  it('skips blank and broken lines', () => {
    const summary = fold(['', '{not json', assistant('m1', [text('ok')], { input: 1 })]).summary()
    expect(summary.contextTokens).toBe(1)
  })
})
