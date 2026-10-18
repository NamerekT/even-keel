import { describe, expect, it } from 'vitest'
import { mailMessage } from './mail.js'
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
  write5m?: number
  write1h?: number
}

function assistant(id: string, content: unknown[], usage: Usage = {}, extra: Record<string, unknown> = {}): string {
  const split = usage.write5m !== undefined || usage.write1h !== undefined
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
        cache_creation_input_tokens: usage.cacheWrite ?? (usage.write5m ?? 0) + (usage.write1h ?? 0),
        output_tokens: usage.output ?? 0,
        ...(split && { cache_creation: { ephemeral_5m_input_tokens: usage.write5m ?? 0, ephemeral_1h_input_tokens: usage.write1h ?? 0 } }),
      },
    },
    ...extra,
  })
}

const text = (value: string) => ({ type: 'text', text: value })
const tool = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id: `toolu_${name}`, name, input })
const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }

function toolResult(id: string, content: unknown[]): string {
  return JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } })
}

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

const DISCONNECTED =
  'Remote Control disconnected — signed-in claude.ai account or organization changed on this machine — run /remote-control to start a session for the current account'

function wrapUp(): string {
  return JSON.stringify({
    type: 'user',
    timestamp: at(),
    isMeta: true,
    usageLimitNote: 'wrap_up',
    message: { role: 'user', content: '[Usage limit reached; a short grace allowance remains, then this turn is cut off without warning.]' },
  })
}

function remoteChange(url: string): string {
  return JSON.stringify({ type: 'attachment', timestamp: at(), attachment: { type: 'remote_session_change', url } })
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

  it('keeps the prompt cache an hour from the request of the last answer when it was written with the hour lifetime', () => {
    const lines = [
      assistant('m1', [text('first')], { write1h: 4000 }),
      assistant('m2', [{ type: 'thinking', thinking: '' }], { cacheRead: 4000, write1h: 300 }),
    ]
    const requestAt = (JSON.parse(lines[1] ?? '') as { timestamp: string }).timestamp
    lines.push(assistant('m2', [text('second')], { cacheRead: 4000, write1h: 300 }))

    expect(fold(lines).summary().cache).toEqual({
      ttl: '1h',
      until: new Date(Date.parse(requestAt) + 60 * 60_000).toISOString(),
    })
  })

  it('takes the shorter lifetime when an answer wrote the cache with both', () => {
    const line = assistant('m1', [text('first')], { write1h: 4000, write5m: 200 })
    const requestAt = (JSON.parse(line) as { timestamp: string }).timestamp

    expect(fold([line]).summary().cache).toEqual({ ttl: '5m', until: new Date(Date.parse(requestAt) + 5 * 60_000).toISOString() })
  })

  it('keeps the known lifetime over an answer that only read the cache', () => {
    const lines = [assistant('m1', [text('first')], { write5m: 4000 }), assistant('m2', [text('second')], { cacheRead: 4000 })]
    const requestAt = (JSON.parse(lines[1] ?? '') as { timestamp: string }).timestamp

    expect(fold(lines).summary().cache).toEqual({ ttl: '5m', until: new Date(Date.parse(requestAt) + 5 * 60_000).toISOString() })
  })

  it('knows no cache lifetime until an answer shows which one it wrote', () => {
    expect(fold([assistant('m1', [text('first')], { cacheRead: 4000, cacheWrite: 100 })]).summary().cache).toBeNull()
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

  it('shows what people wrote to the session, without meta lines, tool results or task notifications', () => {
    const user = (content: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content }, ...extra })
    const summary = fold([
      user('ABC-7\n\nContinue   the task.', { origin: { kind: 'human' } }),
      user('Base directory for this skill', { isMeta: true }),
      assistant('m1', [tool('Read', { file_path: 'a.ts' })]),
      user([{ type: 'tool_result', content: 'ok' }]),
      user('<task-notification>done</task-notification>', { origin: { kind: 'task-notification' } }),
      user([
        text('<browser_instruction>Use the tools.</browser_instruction>'),
        { type: 'image', source: {} },
        text('Why is it red?'),
        text('<pasted_content id="1">log</pasted_content>'),
      ]),
    ]).summary()

    expect(summary.feed.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'prompt', text: 'ABC-7 Continue the task.' },
      { kind: 'tool', text: 'Read a.ts' },
      { kind: 'prompt', text: 'Why is it red? <pasted_content id="1">log</pasted_content>' },
    ])
    expect(summary.action).toMatchObject({ kind: 'tool' })
  })

  it('follows the turn from the last prompt and the call still running', () => {
    const prompt = (content: string) => JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content } })
    const lines = [prompt('ABC-7'), assistant('m1', [text('first')])]
    const second = prompt('Go on.')
    lines.push(second, assistant('m2', [{ type: 'thinking', thinking: '' }]), assistant('m2', [tool('Bash', { command: 'npm test' })]))
    const running = fold(lines).summary()

    expect(running.turn).toEqual({ startedAt: JSON.parse(second).timestamp, tool: 'Bash npm test' })

    lines.push(toolResult('toolu_Bash', [text('ok')]), assistant('m3', [text('done')]))
    expect(fold(lines).summary().turn).toMatchObject({ tool: null })
  })

  it('knows no turn before the first prompt', () => {
    expect(fold([assistant('m1', [text('hello')])]).summary().turn).toBeNull()
  })

  it('keeps texts, prompts and shell commands whole when folding the whole transcript', () => {
    const long = `Plan:\n- one\n- two\n${'x'.repeat(700)}`
    const whole = new TranscriptFold(Infinity, true)
    for (const line of [
      JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: `ABC-7\n\n${long}` } }),
      assistant('m1', [text(long), tool('Bash', { command: 'npm run build\nnpm test', description: 'Build and test' })]),
      assistant('m2', [tool('Read', { file_path: 'a.ts' })]),
    ]) {
      whole.push(line)
    }

    expect(whole.summary().feed.map(({ at: _, ...line }) => line)).toEqual([
      { kind: 'prompt', text: `ABC-7\n\n${long}` },
      { kind: 'text', text: long },
      { kind: 'tool', text: 'Bash Build and test', detail: 'npm run build\nnpm test', tool: 'toolu_Bash', name: 'Bash', subject: 'Build and test' },
      { kind: 'tool', text: 'Read a.ts', tool: 'toolu_Read', name: 'Read', subject: 'a.ts' },
    ])
  })

  it('adds an image line after a tool result with pictures, in a whole transcript only, the data left out', () => {
    const lines = [
      assistant('m1', [tool('Read', { file_path: `${CWD}\\.temp\\shot.png` }), tool('Grep', { pattern: 'x' })]),
      toolResult('toolu_Grep', [text('a.ts:1')]),
      toolResult('toolu_Read', [IMAGE, IMAGE]),
      toolResult('toolu_mcp', [IMAGE]),
    ]
    const whole = new TranscriptFold(Infinity, true)
    for (const line of lines) whole.push(line)

    expect(whole.summary().feed.map(({ at: _, ...line }) => line)).toEqual([
      { kind: 'tool', text: 'Read .temp/shot.png', tool: 'toolu_Read', name: 'Read', subject: `${CWD}\\.temp\\shot.png` },
      { kind: 'tool', text: 'Grep x', tool: 'toolu_Grep', name: 'Grep', subject: 'x' },
      { kind: 'image', text: 'shot.png', tool: 'toolu_Read', images: 2 },
      { kind: 'image', text: '', tool: 'toolu_mcp', images: 1 },
    ])
    expect(fold(lines).summary().feed.map((line) => line.kind)).toEqual(['tool', 'tool'])
  })

  it('names the tool, its subject and the size of an edit on the tool lines of a whole transcript', () => {
    const file = `${CWD}\\web\\a.ts`
    const lines = [
      assistant('m1', [
        tool('Edit', { file_path: file, old_string: 'one\ntwo\nthree', new_string: 'one\n2\n2.5\nthree' }),
        tool('Write', { file_path: file, content: 'a\nb\nc\n' }),
        tool('MultiEdit', { file_path: file, edits: [{ old_string: 'x', new_string: 'y\nz' }, { old_string: 'p\nq', new_string: '' }] }),
        tool('Grep', { pattern: 'needle' }),
        tool('Bash', { command: 'npm test' }),
      ]),
    ]
    const whole = new TranscriptFold(Infinity, true)
    for (const line of lines) whole.push(line)

    expect(whole.summary().feed.map(({ name, subject, added, removed }) => ({ name, subject, added, removed }))).toEqual([
      { name: 'Edit', subject: file, added: 2, removed: 1 },
      { name: 'Write', subject: file, added: 3, removed: 0 },
      { name: 'MultiEdit', subject: file, added: 2, removed: 3 },
      { name: 'Grep', subject: 'needle', added: undefined, removed: undefined },
      { name: 'Bash', subject: undefined, added: undefined, removed: undefined },
    ])
    expect(fold(lines).summary().feed.every((line) => line.name === undefined && line.added === undefined)).toBe(true)
  })

  it('adds a failed line after a tool result that is an error, in a whole transcript only', () => {
    const lines = [
      assistant('m1', [tool('Bash', { command: 'npm test', description: 'Run tests' })]),
      JSON.stringify({
        type: 'user',
        timestamp: at(),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_Bash', is_error: true, content: 'Exit code 1\n  FAIL a.test.ts' }] },
      }),
    ]
    const whole = new TranscriptFold(Infinity, true)
    for (const line of lines) whole.push(line)

    expect(whole.summary().feed.at(-1)).toMatchObject({ kind: 'failed', tool: 'toolu_Bash', text: 'Exit code 1\n  FAIL a.test.ts' })
    expect(fold(lines).summary().feed.map((line) => line.kind)).toEqual(['tool'])
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

  it('tells an API key out of credit from the other key errors', () => {
    const empty = fold([assistant('m1', [text('working')]), apiError('billing_error', 'Credit balance is too low')]).summary()
    expect(empty.apiError).toMatchObject({ kind: 'credit', text: 'Credit balance is too low' })
    expect(fold([apiError('rate_limit', 'Request rejected (429)')]).summary().apiError).toMatchObject({ kind: 'limit' })
    expect(fold([apiError('authentication_failed', 'Invalid API key')]).summary().apiError).toMatchObject({ kind: 'error' })
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

  it('takes a usage-limit wrap-up note as a limit hit that outlives the wrap-up answer', () => {
    const summary = fold([
      assistant('m1', [text('working')]),
      wrapUp(),
      assistant('m2', [text('Usage limit reached, stopping here.')]),
    ]).summary()

    expect(summary.apiError).toMatchObject({ kind: 'limit' })
    expect(summary.feed.some((line) => line.kind === 'error')).toBe(true)
    expect(summary.lastReplyAt).toBe(new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + clock).toISOString())
  })

  it('forgets a wrap-up note once someone writes to the session again', () => {
    const limited = fold([assistant('m1', [text('working')]), wrapUp(), assistant('m2', [text('stopping')])])
    limited.push(JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: 'Go on.' } }))
    expect(limited.summary().apiError).toBeNull()
  })

  it('keeps a wrap-up note through tool results and meta lines', () => {
    const summary = fold([
      wrapUp(),
      JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
      JSON.stringify({ type: 'user', timestamp: at(), isMeta: true, message: { role: 'user', content: 'reminder' } }),
    ]).summary()
    expect(summary.apiError).toMatchObject({ kind: 'limit' })
  })

  it('notices Remote Control dropping and coming back', () => {
    const dropped = fold([
      remoteChange('https://claude.ai/code/session_01First'),
      JSON.stringify({ type: 'system', subtype: 'informational', level: 'warning', timestamp: at(), content: DISCONNECTED }),
      JSON.stringify({ type: 'bridge-session', sessionId: 'abc', bridgeSessionId: 'cse_01First' }),
    ])
    expect(dropped.summary()).toMatchObject({ remoteUrl: 'https://claude.ai/code/session_01First', remoteLost: true })

    dropped.push(remoteChange('https://claude.ai/code/session_01Second'))
    expect(dropped.summary()).toMatchObject({ remoteUrl: 'https://claude.ai/code/session_01Second', remoteLost: false })
  })

  it('keeps the last message of the session whole', () => {
    const long = `Done so far:\n- one\n- two\n\nLeft:\n1. ${'x'.repeat(700)}`
    const summary = fold([assistant('m1', [text(long)]), assistant('m2', [tool('Read', { file_path: 'a.ts' })])]).summary()
    expect(summary.lastMessage).toBe(long)
    expect(fold([assistant('m1', [tool('Read', { file_path: 'a.ts' })])]).summary().lastMessage).toBeNull()
  })

  describe('checkpoint', () => {
    const prompt = (content: string) => JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content } })

    it('takes the path from the last line of the last answer', () => {
      const summary = fold([
        assistant('m1', [tool('Write', { file_path: '.temp/handoff.md' })]),
        assistant('m2', [text('Handoff is written.\n\nCHECKPOINT: .temp/handoff.md\n')]),
      ]).summary()
      expect(summary.checkpoint).toBe('.temp/handoff.md')
    })

    it('knows no checkpoint when the last answer has no mark', () => {
      expect(fold([assistant('m1', [text('All done, merged into main.')])]).summary().checkpoint).toBeNull()
    })

    it('ignores a mark that is not the last line of the answer', () => {
      const summary = fold([assistant('m1', [text('CHECKPOINT: .temp/handoff.md\nOn second thought, I carry on myself.')])]).summary()
      expect(summary.checkpoint).toBeNull()
    })

    it('forgets a mark from an earlier answer once a later one comes without it', () => {
      const summary = fold([
        assistant('m1', [text('CHECKPOINT: .temp/handoff.md')]),
        prompt('Keep going here, do not hand over.'),
        assistant('m2', [text('Carrying on.')]),
      ]).summary()
      expect(summary.checkpoint).toBeNull()
    })

    it('forgets a mark once the session calls a tool after it', () => {
      const summary = fold([assistant('m1', [text('CHECKPOINT: .temp/handoff.md'), tool('Bash', { command: 'npm test' })])]).summary()
      expect(summary.checkpoint).toBeNull()
    })

    it('forgets a mark once someone writes to the session', () => {
      const marked = fold([assistant('m1', [text('CHECKPOINT: .temp/handoff.md')])])
      marked.push(prompt('Wait, one more thing.'))
      expect(marked.summary().checkpoint).toBeNull()
    })

    it('keeps the mark through meta lines after it', () => {
      const summary = fold([
        assistant('m1', [text('CHECKPOINT: .temp/handoff.md')]),
        JSON.stringify({ type: 'user', timestamp: at(), isMeta: true, message: { role: 'user', content: 'reminder' } }),
      ]).summary()
      expect(summary.checkpoint).toBe('.temp/handoff.md')
    })

    it('reads a mark wrapped in markdown code or bold', () => {
      expect(fold([assistant('m1', [text('Done.\n`CHECKPOINT: .temp/handoff.md`')])]).summary().checkpoint).toBe('.temp/handoff.md')
      expect(fold([assistant('m1', [text('**CHECKPOINT:** `.temp/handoff.md`  ')])]).summary().checkpoint).toBe('.temp/handoff.md')
    })
  })

  describe('asking', () => {
    const answer = (name: string) =>
      JSON.stringify({
        type: 'user',
        timestamp: at(),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${name}`, content: 'answered' }] },
      })

    it('is raised while an AskUserQuestion has no result', () => {
      expect(fold([assistant('m1', [tool('AskUserQuestion', { questions: [] })])]).summary().asking).toBe(true)
    })

    it('drops once the answer comes as a tool result', () => {
      const summary = fold([assistant('m1', [tool('AskUserQuestion', { questions: [] })]), answer('AskUserQuestion')]).summary()
      expect(summary.asking).toBe(false)
    })

    it('stays down for other tools and stays up through an answer to another tool', () => {
      expect(fold([assistant('m1', [tool('Read', { file_path: 'a.ts' })])]).summary().asking).toBe(false)
      const open = fold([assistant('m1', [tool('AskUserQuestion', { questions: [] }), tool('Read', { file_path: 'a.ts' })]), answer('Read')])
      expect(open.summary().asking).toBe(true)
    })
  })

  describe('questions', () => {
    const QUESTIONS = [
      {
        question: 'Which color?',
        header: 'Color',
        multiSelect: false,
        options: [
          { label: 'Red (Recommended)', description: 'Warm' },
          { label: 'Blue', description: 'Cold', preview: 'body { color: blue }' },
        ],
      },
      { question: 'Which sizes?', header: 'Size', multiSelect: true, options: [{ label: 'S', description: '' }, { label: 'L', description: '' }] },
    ]
    const ask = () => assistant('m1', [tool('AskUserQuestion', { questions: QUESTIONS })])
    const result = (toolUseResult: unknown, isError = false) =>
      JSON.stringify({
        type: 'user',
        timestamp: at(),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_AskUserQuestion', content: 'done', is_error: isError }] },
        toolUseResult,
      })
    const prompt = (content: string) => JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content } })
    const whole = (lines: string[]) => {
      const result = new TranscriptFold(Infinity, true)
      for (const line of lines) result.push(line)
      return result
    }

    it('gives the open question with its options', () => {
      expect(fold([ask()]).summary().ask).toEqual({ id: 'toolu_AskUserQuestion', questions: QUESTIONS })
    })

    it('drops malformed questions and options, keeps the rest', () => {
      const line = assistant('m1', [
        tool('AskUserQuestion', { questions: [{ question: 'Q?', options: [{ label: 'A' }, { description: 'no label' }] }, 'junk'] }),
      ])
      expect(fold([line]).summary().ask?.questions).toEqual([
        { question: 'Q?', header: '', multiSelect: false, options: [{ label: 'A', description: '' }] },
      ])
    })

    it('carries the question on the tool line of a whole transcript only', () => {
      expect(whole([ask()]).summary().feed.at(-1)?.ask?.id).toBe('toolu_AskUserQuestion')
      expect(fold([ask()]).summary().feed.at(-1)?.ask).toBeUndefined()
    })

    it('adds an answer line when the tool returns the answers', () => {
      const summary = whole([ask(), result({ questions: QUESTIONS, answers: { 'Which color?': 'Blue', 'Which sizes?': 'S, L' } })]).summary()
      expect(summary.ask).toBeNull()
      expect(summary.feed.at(-1)).toMatchObject({
        kind: 'answer',
        text: '',
        answers: { ask: 'toolu_AskUserQuestion', answers: { 'Which color?': 'Blue', 'Which sizes?': 'S, L' } },
      })
    })

    it('takes the next prompt as the answer to a question the tool left without one', () => {
      const reply = '- "Which color?" → Blue\n- "Which sizes?" → L\n\nThanks'
      for (const lines of [[ask(), result(undefined, true), prompt(reply)], [ask(), prompt(reply)]]) {
        const summary = whole(lines).summary()
        expect(summary.ask).toBeNull()
        expect(summary.feed.at(-1)).toMatchObject({
          kind: 'answer',
          text: 'Thanks',
          answers: { ask: 'toolu_AskUserQuestion', answers: { 'Which color?': 'Blue', 'Which sizes?': 'L' } },
        })
      }
    })

    it('reads the answers of a question the stop lost from the prompt alone', () => {
      const reply = 'The question you asked through AskUserQuestion was lost when the session restarted:\n- "Which color?" → Blue\n  Blue — Cold'
      const line = whole([prompt(reply)]).summary().feed.at(-1)
      expect(line).toEqual({ at: expect.any(String), kind: 'answer', text: '', answers: { answers: { 'Which color?': 'Blue' } } })
    })

    it('keeps only the own words and the files of a prompt, old replies included', () => {
      const reply = "The user's reply from the Even Keel page.\n\nLook here\n\nFiles from the user:\n- C:/w/.temp/inbox/a.png\n"
      expect(whole([prompt(reply)]).summary().feed.at(-1)).toMatchObject({ kind: 'prompt', text: 'Look here', files: ['C:/w/.temp/inbox/a.png'] })
    })

    it('takes a prompt as an ordinary one once the question is answered', () => {
      const summary = whole([ask(), result({ answers: { 'Which color?': 'Blue' } }), prompt('next')]).summary()
      expect(summary.feed.at(-1)).toMatchObject({ kind: 'prompt', text: 'next' })
    })
  })

  describe('chat mailbox', () => {
    const mail = (id: number, text: string, files: string[] = []) => ({
      id,
      task: 'ABC-1',
      sessionId: 's',
      text,
      files,
      postedAt: '2026-10-18T10:00:00.000Z',
      fate: 'delivered' as const,
      event: null,
      settledAt: null,
    })
    const hookContext = (message: string) =>
      JSON.stringify({ type: 'attachment', timestamp: at(), attachment: { type: 'hook_additional_context', content: [message], hookName: 'PostToolUse:Bash' } })
    const whole = (lines: string[]) => {
      const result = new TranscriptFold(Infinity, true)
      for (const line of lines) result.push(line)
      return result
    }
    const prompts = (fold: TranscriptFold) => fold.summary().feed.filter((line) => line.kind === 'prompt')

    it('shows a message a hook put into the context as the user prompt, once per id', () => {
      const message = mailMessage([mail(7, 'Use the other parser.', ['C:/w/.temp/inbox/a.png']), mail(8, 'And skip the cache.')], 'PostToolUse', 'en')
      const summary = whole([hookContext(message), hookContext(message)])
      expect(prompts(summary)).toEqual([
        { at: expect.any(String), kind: 'prompt', text: 'Use the other parser.', files: ['C:/w/.temp/inbox/a.png'] },
        { at: expect.any(String), kind: 'prompt', text: 'And skip the cache.' },
      ])
    })

    it('ignores other attachments that happen to hold the mark', () => {
      const message = mailMessage([mail(7, 'From a file.')], 'PostToolUse', 'en')
      const edited = JSON.stringify({ type: 'attachment', timestamp: at(), attachment: { type: 'edited_text_file', snippet: message } })
      expect(prompts(whole([edited]))).toEqual([])
    })

    it('shows a message given at a stop, without starting a new turn on the feedback', () => {
      const feedback = JSON.stringify({
        type: 'user',
        timestamp: at(),
        isMeta: true,
        message: { role: 'user', content: `Stop hook feedback:\n${mailMessage([mail(9, 'One more thing.')], 'Stop', 'en')}` },
      })
      expect(prompts(whole([feedback]))).toEqual([{ at: expect.any(String), kind: 'prompt', text: 'One more thing.' }])
    })

    it('shows a message that turned a question down, and the question is not left waiting for an answer', () => {
      const denied = JSON.stringify({
        type: 'user',
        timestamp: at(),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_AskUserQuestion', content: mailMessage([mail(10, 'Not now.')], 'AskUserQuestion', 'en'), is_error: true }],
        },
      })
      const summary = whole([assistant('m1', [tool('AskUserQuestion', { questions: [] })]), denied, JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: 'later' } })])
      expect(summary.summary().ask).toBeNull()
      expect(prompts(summary).map((line) => line.text)).toEqual(['Not now.', 'later'])
    })

    it('does not read the mark out of an ordinary tool result', () => {
      const read = toolResult('toolu_Read', [text(mailMessage([mail(11, 'In the source.')], 'PostToolUse', 'en'))])
      expect(prompts(whole([assistant('m1', [tool('Read', { file_path: 'mail.ts' })]), read]))).toEqual([])
    })
  })

  describe('a message sent mid-turn', () => {
    const queued = (prompt: unknown, origin: Record<string, unknown>) =>
      JSON.stringify({ type: 'attachment', timestamp: at(), attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin } })
    const thinking = (value: string) => ({ type: 'thinking', thinking: value, signature: 'c2ln' })

    it('shows a message the CLI took into the running turn as the user prompt, without starting a new turn', () => {
      const started = fold([JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: 'ABC-1' } })])
      const turn = started.summary().turn
      started.push(queued([IMAGE, text('Should these settings go?')], { kind: 'human' }))
      const summary = started.summary()
      expect(summary.feed.at(-1)).toMatchObject({ kind: 'prompt', text: 'Should these settings go?' })
      expect(summary.turn).toEqual(turn)
    })

    it('takes a plain string prompt too', () => {
      expect(fold([queued('Skip the cache.', { kind: 'human' })]).summary().feed).toEqual([
        { at: expect.any(String), kind: 'prompt', text: 'Skip the cache.' },
      ])
    })

    it('leaves out what the session queued for itself', () => {
      const notice = queued('<task-notification>done</task-notification>', { kind: 'task-notification', producer: 'session-task' })
      expect(fold([notice]).summary().feed).toEqual([])
    })

    it('shows the narration of a thinking block as text and leaves the hidden thinking out', () => {
      const summary = fold([assistant('m1', [thinking(''), thinking('Confirmed: the keys come from the profile.'), tool('Read', { file_path: 'a.ts' })])]).summary()
      expect(summary.feed.map((line) => [line.kind, line.text])).toEqual([
        ['text', 'Confirmed: the keys come from the profile.'],
        ['tool', expect.any(String)],
      ])
      expect(summary.lastMessage).toBeNull()
    })
  })

  it('skips blank and broken lines', () => {
    const summary = fold(['', '{not json', assistant('m1', [text('ok')], { input: 1 })]).summary()
    expect(summary.contextTokens).toBe(1)
  })
})
