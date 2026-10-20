import { describe, expect, it } from 'vitest'
import { limitsOfRollout, RolloutFold, rolloutSessionId } from './rollout.js'

const CWD = 'C:\\repos\\example'
const THREAD = '01a14a11-16af-7a80-acdb-6fb33607c527'
let clock = 0

function at(): string {
  clock += 1000
  return new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + clock).toISOString()
}

const line = (type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: at(), ordinal: clock, type, payload })
const event = (payload: Record<string, unknown>) => line('event_msg', payload)
const item = (value: Record<string, unknown>) => event({ type: 'item_completed', thread_id: THREAD, item: value })

const meta = (branch = 'btn-1/task') =>
  line('session_meta', { id: THREAD, session_id: THREAD, cwd: CWD, source: 'exec', cli_version: '0.162.1', git: { branch } })
const started = () => event({ type: 'task_started', model_context_window: 258400 })
const user = (text: string) => item({ type: 'UserMessage', content: [{ type: 'text', text, text_elements: [] }] })
const agent = (text: string, phase = 'final_answer') => item({ type: 'AgentMessage', content: [{ type: 'Text', text }], phase })
const complete = (last: string) => event({ type: 'task_complete', last_agent_message: last })
const shell = (command: string) =>
  item({ type: 'CommandExecution', command: ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-Command', command], cwd: 'file:///C:/repos/example', status: 'completed' })
const patch = (path: string, kind = 'update') => item({ type: 'FileChange', changes: { [path]: { type: kind } }, status: 'completed' })

interface Window {
  used: number
  minutes: number
  resets: number
}

function tokens(context: number, cached: number, total: [number, number, number], primary?: Window, secondary?: Window): string {
  const [input, cache, output] = total
  const window = (value: Window | undefined) =>
    value === undefined ? null : { used_percent: value.used, window_minutes: value.minutes, resets_at: value.resets }
  return event({
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: input, cached_input_tokens: cache, cache_write_input_tokens: 0, output_tokens: output },
      last_token_usage: { input_tokens: context, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: 1 },
      model_context_window: 258400,
    },
    rate_limits: primary === undefined ? null : { limit_id: 'codex', primary: window(primary), secondary: window(secondary), plan_type: 'plus' },
  })
}

function fold(lines: string[], whole = false): RolloutFold {
  const result = new RolloutFold(30, whole)
  for (const value of lines) result.push(value)
  return result
}

describe('RolloutFold', () => {
  it('takes the branch, the folder and the activity span', () => {
    const summary = fold([meta(), started(), user('BTN-1'), agent('Done.'), complete('Done.')]).summary()
    expect(summary.gitBranch).toBe('btn-1/task')
    expect(summary.workdir).toBe(CWD)
    expect(summary.firstActivityAt).not.toBeNull()
    expect(summary.lastActivityAt).not.toBe(summary.firstActivityAt)
    expect(summary.lastMessage).toBe('Done.')
    expect(summary.ask).toBeNull()
    expect(summary.cache).toBeNull()
  })

  it('names the model of the last turn', () => {
    const context = (model: string) => line('turn_context', { cwd: CWD, model, effort: 'medium' })
    expect(fold([meta(), context('gpt-6-luna'), started(), context('gpt-6.1-sol')]).summary().model).toBe('gpt-6.1-sol')
    expect(fold([meta(), started()]).summary().model).toBeNull()
  })

  it('feeds the prompt, the texts and the tool calls with a stage', () => {
    const summary = fold([
      meta(),
      user('BTN-1\nsecond line'),
      agent('Reading the task.', 'commentary'),
      patch('C:\\repos\\example\\src\\a.ts'),
      shell('npx vitest run'),
      shell('git commit -m "[BTN-1] Done"'),
    ]).summary()
    expect(summary.feed.map((value) => [value.kind, value.text])).toEqual([
      ['prompt', 'BTN-1 second line'],
      ['text', 'Reading the task.'],
      ['tool', 'Edit src/a.ts'],
      ['tool', 'Shell npx vitest run'],
      ['tool', 'Shell git commit -m "[BTN-1] Done"'],
    ])
    expect(summary.stage).toBe('commit')
    expect(summary.action?.text).toBe('Shell git commit -m "[BTN-1] Done"')
  })

  it('keeps the whole command and the prompt as written in a whole transcript', () => {
    const summary = fold([user('BTN-1\nsecond line'), shell('git status\ngit log')], true).summary()
    expect(summary.feed[0]?.text).toBe('BTN-1\nsecond line')
    expect(summary.feed[1]).toMatchObject({ kind: 'tool', text: 'Shell git status', detail: 'git status\ngit log' })
  })

  it('names every file of a patch and marks the edit stage', () => {
    const summary = fold([meta(), patch('C:\\repos\\example\\a.ts', 'add'), patch('C:\\elsewhere\\b.ts', 'delete')]).summary()
    expect(summary.feed.map((value) => value.text)).toEqual(['Edit a.ts', 'Edit C:/elsewhere/b.ts'])
    expect(summary.stage).toBe('edit')
  })

  it('names the tool, the file and the size of each change in a whole transcript', () => {
    const changes = {
      'C:\\repos\\example\\a.ts': { type: 'add', content: 'one\ntwo\n' },
      'C:\\repos\\example\\b.ts': { type: 'delete', content: 'gone\n' },
      'C:\\repos\\example\\c.ts': { type: 'update', unified_diff: '--- a/c.ts\n+++ b/c.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n same\n' },
      'C:\\repos\\example\\d.ts': { type: 'update' },
    }
    const summary = fold([meta(), item({ id: 'exec-1', type: 'FileChange', changes, status: 'completed' }), shell('git status')], true).summary()
    expect(summary.feed.map(({ name, subject, added, removed, tool }) => ({ name, subject, added, removed, tool }))).toEqual([
      { name: 'Edit', subject: 'C:\\repos\\example\\a.ts', added: 2, removed: 0, tool: 'exec-1' },
      { name: 'Edit', subject: 'C:\\repos\\example\\b.ts', added: 0, removed: 1, tool: 'exec-1' },
      { name: 'Edit', subject: 'C:\\repos\\example\\c.ts', added: 2, removed: 1, tool: 'exec-1' },
      { name: 'Edit', subject: 'C:\\repos\\example\\d.ts', added: undefined, removed: undefined, tool: 'exec-1' },
      { name: 'Shell', subject: undefined, added: undefined, removed: undefined, tool: undefined },
    ])
    expect(fold([meta(), item({ id: 'exec-1', type: 'FileChange', changes, status: 'completed' })]).summary().feed[0]?.added).toBeUndefined()
  })

  it('adds a failed line after a call that failed, in a whole transcript only', () => {
    const failed = item({ id: 'exec-2', type: 'CommandExecution', command: ['pwsh', '-Command', 'npm test'], status: 'failed', exit_code: 1, aggregated_output: 'FAIL a.test.ts\n' })
    expect(fold([failed], true).summary().feed.map(({ at: _, ...value }) => value)).toEqual([
      { kind: 'tool', text: 'Shell npm test', detail: 'npm test', name: 'Shell', tool: 'exec-2' },
      { kind: 'failed', text: 'Exit code 1\nFAIL a.test.ts', tool: 'exec-2' },
    ])
    expect(fold([failed]).summary().feed.map((value) => value.kind)).toEqual(['tool'])
  })

  it('names the exit code of a failed command whose output is ordinary, and of one the sandbox did not start', () => {
    const quiet = item({ id: 'exec-3', type: 'CommandExecution', command: ['pwsh', '-Command', 'git status; rg --files -g AGENTS.md'], status: 'failed', exit_code: 1, aggregated_output: 'On branch main\nnothing to commit\n' })
    const unstarted = item({ id: 'exec-4', type: 'CommandExecution', command: ['pwsh', '-Command', 'git status'], status: 'failed', exit_code: -1, aggregated_output: 'Failed to create unified exec process: helper_unknown_error: setup refresh had errors' })
    const patch = item({ id: 'exec-5', type: 'FileChange', changes: { 'C:\\repos\\example\\a.ts': { type: 'add', content: 'x\n' } }, status: 'failed', stderr: 'patch rejected' })
    const failures = fold([quiet, unstarted, patch], true).summary().feed.filter((line) => line.kind === 'failed').map((line) => line.text)
    expect(failures).toEqual([
      'Exit code 1\nOn branch main\nnothing to commit',
      'Exit code -1\nFailed to create unified exec process: helper_unknown_error: setup refresh had errors',
      'patch rejected',
    ])
  })

  it('reads a tracker call as the task stage', () => {
    const summary = fold([item({ type: 'McpToolCall', server: 'huly', tool: 'get_issue', arguments: { identifier: 'BTN-1' } })]).summary()
    expect(summary.feed[0]?.text).toBe('huly get_issue BTN-1')
    expect(summary.stage).toBe('task')
  })

  it('takes the context from the last request and the tokens from the session totals', () => {
    const summary = fold([tokens(14000, 0, [14000, 0, 100]), tokens(25000, 24000, [39000, 24000, 120])]).summary()
    expect(summary.contextTokens).toBe(25000)
    expect(summary.tokens).toEqual({ input: 15000, cacheRead: 24000, cacheWrite: 0, output: 120 })
  })

  it('takes the context window the model runs with from the turn start and each token count', () => {
    expect(fold([meta()]).summary().contextWindow).toBeNull()
    expect(fold([meta(), started()]).summary().contextWindow).toBe(258400)
    const smaller = event({ type: 'token_count', info: { last_token_usage: { input_tokens: 9000 }, model_context_window: 128000 } })
    expect(fold([meta(), started(), smaller]).summary().contextWindow).toBe(128000)
  })

  it('follows the turn from its start, with no call known to be running', () => {
    const turn = started()
    const summary = fold([started(), tokens(14000, 0, [14000, 0, 100]), turn, user('Go on.')]).summary()
    expect(summary.turn).toEqual({ startedAt: JSON.parse(turn).timestamp, tool: null })
    expect(fold([meta(), user('BTN-1')]).summary().turn).toBeNull()
  })

  it('finds a checkpoint on the last line of the last message, and a new prompt clears it', () => {
    const marked = fold([agent('Handing over.\nCHECKPOINT: .temp/handoff.md')])
    expect(marked.summary().checkpoint).toBe('.temp/handoff.md')
    marked.push(user('go on'))
    expect(marked.summary().checkpoint).toBeNull()
  })

  it('finds a pull request mark on the last line of the last message, and a new prompt clears it', () => {
    const marked = fold([agent('Ready.\nPULL REQUEST: .temp/pull-request.md')])
    expect(marked.summary().pullRequest).toBe('.temp/pull-request.md')
    marked.push(user('go on'))
    expect(marked.summary().pullRequest).toBeNull()
  })

  it('finds a no changes mark on the last line of the last message, and a new prompt clears it', () => {
    const marked = fold([agent('Checked.\nNO CHANGES: the work is already in main')])
    expect(marked.summary().noChanges).toBe('the work is already in main')
    marked.push(user('go on'))
    expect(marked.summary().noChanges).toBeNull()
  })

  it('reads an error event as an API error and a limit by its text', () => {
    expect(fold([event({ type: 'error', message: 'stream disconnected' })]).summary().apiError).toMatchObject({ kind: 'error', text: 'stream disconnected' })
    const limit = fold([event({ type: 'error', message: "You've hit your usage limit. Try again later." })]).summary()
    expect(limit.apiError?.kind).toBe('limit')
    expect(limit.feed.at(-1)?.kind).toBe('error')
  })

  it('reads an API key out of money as credit, not as a limit', () => {
    const quota = fold([event({ type: 'error', message: 'Quota exceeded. Check your plan and billing details.' })]).summary()
    expect(quota.apiError).toMatchObject({ kind: 'credit', text: 'Quota exceeded. Check your plan and billing details.' })
    const body = JSON.stringify({
      type: 'error',
      status: 429,
      error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' },
    })
    const failed = event({ type: 'task_complete', last_agent_message: null, error: { message: body, codex_error_info: 'other' } })
    expect(fold([meta(), started(), user('TSK-1'), failed]).summary().apiError?.kind).toBe('credit')
  })

  it('reads the error of a failed turn from task_complete, unwrapping the JSON of the API answer', () => {
    const body = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: "The 'example-model' model is not supported." } })
    const failed = event({ type: 'task_complete', last_agent_message: null, error: { message: body, codex_error_info: 'other' } })
    const summary = fold([meta(), started(), user('TSK-1'), failed]).summary()
    expect(summary.apiError).toMatchObject({ kind: 'error', text: "The 'example-model' model is not supported." })
    expect(summary.feed.at(-1)?.kind).toBe('error')
    const plain = event({ type: 'task_complete', last_agent_message: null, error: { message: 'plain text' } })
    expect(fold([plain]).summary().apiError?.text).toBe('plain text')
  })

  it('clears the API error once the session answers again', () => {
    expect(fold([event({ type: 'error', message: 'boom' }), agent('Back.')]).summary().apiError).toBeNull()
  })

  it('feeds each chat message a hook gave the session as the user prompt, once', () => {
    const marked = (id: number, text: string) => `<even-keel-message id="${id}">\n${text}\n</even-keel-message>`
    const context = (text: string) => line('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text }] })
    const hook = context(`The user wrote to you.\n\n${marked(10, 'first')}\n\n${marked(11, 'second')}`)
    const summary = fold([meta(), started(), user('BTN-1'), shell('Start-Sleep 5'), hook, hook, context('Plain instructions.'), agent('Seen.')]).summary()
    expect(summary.feed.map((value) => [value.kind, value.text])).toEqual([
      ['prompt', 'BTN-1'],
      ['tool', 'Shell Start-Sleep 5'],
      ['prompt', 'first'],
      ['prompt', 'second'],
      ['text', 'Seen.'],
    ])
  })

  it('feeds the chat messages of a marked prompt instead of the prompt itself', () => {
    const summary = fold([meta(), user(`Go on.\n\n<even-keel-message id="3">\nthird\n</even-keel-message>`)]).summary()
    expect(summary.feed.map((value) => [value.kind, value.text])).toEqual([['prompt', 'third']])
  })

  it('skips reasoning, response items and lines that are not JSON', () => {
    const summary = fold(['not json', line('response_item', { type: 'message' }), item({ type: 'Reasoning' }), '']).summary()
    expect(summary.feed).toEqual([])
    expect(summary.firstActivityAt).toBeNull()
  })
})

describe('rolloutSessionId', () => {
  it('is the thread of the first line', () => {
    expect(rolloutSessionId(meta())).toBe(THREAD)
    expect(rolloutSessionId(started())).toBeUndefined()
    expect(rolloutSessionId('garbage')).toBeUndefined()
  })
})

describe('limitsOfRollout', () => {
  const resets = Date.parse('2026-01-01T14:00:00Z') / 1000

  it('maps the five-hour and the weekly window from the newest token count, as of its time', () => {
    const newest = tokens(1, 0, [1, 0, 1], { used: 12.5, minutes: 300, resets }, { used: 40, minutes: 10080, resets: resets + 3600 })
    const text = [tokens(1, 0, [1, 0, 1], { used: 1, minutes: 300, resets }), newest, tokens(1, 0, [1, 0, 1])].join('\n')
    expect(limitsOfRollout(text)).toEqual({
      fiveHour: { usedPercentage: 12.5, resetsAt: '2026-01-01T14:00:00.000Z' },
      sevenDay: { usedPercentage: 40, resetsAt: '2026-01-01T15:00:00.000Z' },
      updatedAt: JSON.parse(newest).timestamp,
      source: 'usage',
    })
  })

  it('maps the free plan 30-day window to the month, with no five-hour or weekly one', () => {
    expect(limitsOfRollout(tokens(1, 0, [1, 0, 1], { used: 12, minutes: 43200, resets }))).toMatchObject({
      fiveHour: null,
      sevenDay: null,
      month: { usedPercentage: 12, resetsAt: '2026-01-01T14:00:00.000Z' },
    })
  })

  it('has no month for a plan without the 30-day window', () => {
    expect(limitsOfRollout(tokens(1, 0, [1, 0, 1], { used: 1, minutes: 300, resets }))).not.toHaveProperty('month')
  })

  it('leaves out windows of other lengths', () => {
    expect(limitsOfRollout(tokens(1, 0, [1, 0, 1], { used: 6, minutes: 1440, resets }))).toEqual(expect.objectContaining({ fiveHour: null, sevenDay: null }))
    expect(limitsOfRollout(tokens(1, 0, [1, 0, 1], { used: 6, minutes: 1440, resets }))).not.toHaveProperty('month')
  })

  it('is undefined without any rate limits', () => {
    expect(limitsOfRollout([meta(), tokens(1, 0, [1, 0, 1])].join('\n'))).toBeUndefined()
  })
})
