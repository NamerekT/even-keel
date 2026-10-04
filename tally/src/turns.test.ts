import { describe, expect, it } from 'vitest'
import { parseEntry } from '../../src/sessions/entry.js'
import type { TranscriptEntry } from './stream.js'
import { turnsOf, type Turn } from './turns.js'

class Transcript {
  private readonly lines: string[] = []
  private n = 0
  private clock = Date.parse('2026-10-03T10:00:00.000Z')

  wait(seconds: number): this {
    this.clock += seconds * 1000
    return this
  }

  prompt(text: string, extra: Record<string, unknown> = {}): this {
    return this.line({ type: 'user', ...extra, message: { role: 'user', content: text } })
  }

  meta(text: string, extra: Record<string, unknown> = {}): this {
    return this.line({ type: 'user', isMeta: true, ...extra, message: { role: 'user', content: [{ type: 'text', text }] } })
  }

  say(text: string, agentId?: string): this {
    return this.line({ type: 'assistant', agentId, message: { id: `m${this.n + 1}`, model: 'claude-opus-5-5', content: [{ type: 'text', text }] } })
  }

  call(name: string, seconds = 0, agentId?: string): this {
    const id = `t${this.n + 1}`
    this.line({ type: 'assistant', agentId, message: { id: `m${this.n + 1}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input: {} }] } })
    this.wait(seconds)
    return this.line({ type: 'user', agentId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'fine' }] } })
  }

  apiError(error: string): this {
    return this.line({ type: 'assistant', isApiErrorMessage: true, error, message: { id: `e${this.n + 1}`, model: '<synthetic>', content: [{ type: 'text', text: 'limit' }] } })
  }

  raw(fields: Record<string, unknown>): this {
    return this.line(fields)
  }

  entries(): TranscriptEntry[] {
    return this.lines.map((line) => parseEntry(line)!)
  }

  private line(fields: Record<string, unknown>): this {
    this.clock += 1000
    this.lines.push(JSON.stringify({ ...fields, uuid: `u${++this.n}`, sessionId: 's1', timestamp: new Date(this.clock).toISOString() }))
    return this
  }
}

const brief = (turns: Turn[]) => turns.map((turn) => [turn.start, turn.startedAt.slice(11, 19), turn.endedAt.slice(11, 19), turn.replies])

describe('turnsOf', () => {
  it('runs a turn from its prompt to the last reply before the next prompt', () => {
    const t = new Transcript().prompt('BTN-1').say('reading').call('Read').say('done').wait(600).prompt('and now?').say('ok')
    expect(brief(turnsOf(t.entries(), false))).toEqual([
      ['prompt', '10:00:01', '10:00:05', 3],
      ['prompt', '10:10:06', '10:10:07', 1],
    ])
  })

  it('marks the first prompt of an Even Keel launch and the resume prompt as not the user', () => {
    const t = new Transcript()
      .prompt('BTN-1\n\n- Worktree готов')
      .say('working')
      .wait(3600)
      .prompt('Лимит сброшен — продолжай с того же места.')
      .say('again')
      .prompt('looks good')
      .say('thanks')
    expect(turnsOf(t.entries(), true).map((turn) => turn.start)).toEqual(['launch', 'resume', 'prompt'])
    expect(turnsOf(t.entries(), false)[0]!.start).toBe('prompt')
  })

  it('starts a turn on a background task notification and on a message from another session', () => {
    const t = new Transcript()
      .prompt('go')
      .say('started a build in the background')
      .wait(120)
      .prompt('<task-notification>\n<task-id>b1</task-id>\n</task-notification>')
      .say('build passed')
      .meta('Another Claude session sent a message:\n<agent-message from="x">done</agent-message>', { origin: { body: 'done' } })
      .say('noted')
    expect(turnsOf(t.entries(), false).map((turn) => turn.start)).toEqual(['prompt', 'notification', 'message'])
  })

  it('starts a turn on a wakeup the session scheduled for itself', () => {
    const t = new Transcript()
      .prompt('go')
      .say('waiting for the reviewer')
      .wait(1200)
      .raw({ type: 'system', subtype: 'scheduled_task_fire' })
      .meta('Continue BTN-1: act on the reviewer result')
      .say('merged')
    expect(brief(turnsOf(t.entries(), false))).toEqual([
      ['prompt', '10:00:01', '10:00:02', 1],
      ['notification', '10:20:03', '10:20:05', 1],
    ])
  })

  it('keeps the CLI turn duration, which leaves out permission prompts', () => {
    const t = new Transcript()
      .prompt('go')
      .call('Bash', 180)
      .say('done')
      .raw({ type: 'system', subtype: 'turn_duration', durationMs: 4500 })
      .prompt('next')
      .say('ok')
    expect(turnsOf(t.entries(), false).map((turn) => turn.cliSeconds)).toEqual([4.5, null])
  })

  it('keeps meta lines, slash command output, interrupts and compaction inside the turn', () => {
    const t = new Transcript()
      .prompt('<command-name>/huly-tracker</command-name>')
      .meta('Base directory for this skill: C:/skills/huly-tracker')
      .say('loaded')
      .prompt('<local-command-stdout>ok</local-command-stdout>')
      .prompt('This session is being continued from a previous conversation', { isCompactSummary: true })
      .say('still going')
      .prompt('[Request interrupted by user]')
      .prompt('<system-reminder>note</system-reminder>')
      .say('stopped')
    const turns = turnsOf(t.entries(), false)
    expect(brief(turns)).toEqual([['prompt', '10:00:01', '10:00:09', 3]])
  })

  it('counts subagent replies as part of the parent turn, not as their own', () => {
    const t = new Transcript().prompt('go').call('Agent', 0).say('sub 1', 'a1').say('sub 2', 'a1').say('done')
    const turns = turnsOf(t.entries(), false)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.replies).toBe(2)
  })

  it('stretches the turn over a background subagent that outlives the parent reply', () => {
    const t = new Transcript()
      .prompt('go')
      .say('started an agent in the background')
      .wait(240)
      .say('sub done', 'a1')
      .meta('Another Claude session sent a message: [Subagent hand-back]', { origin: { body: 'report' } })
      .say('got it')
    expect(brief(turnsOf(t.entries(), false))).toEqual([
      ['prompt', '10:00:01', '10:04:03', 1],
      ['message', '10:04:04', '10:04:05', 1],
    ])
  })

  it('takes the time spent on a question to the user out of the turn', () => {
    const t = new Transcript().prompt('go').call('AskUserQuestion', 300).say('thanks').call('ExitPlanMode', 60).say('done')
    const [turn] = turnsOf(t.entries(), false)
    expect(turn!.askSeconds).toBe(362)
  })

  it('marks a turn cut by the usage limit, whether it had replies or not', () => {
    const t = new Transcript().prompt('go').say('working').apiError('rate_limit').wait(3600).prompt('продолжай').apiError('rate_limit')
    const turns = turnsOf(t.entries(), false)
    expect(turns.map((turn) => [turn.limited, turn.replies])).toEqual([
      [true, 1],
      [true, 0],
    ])
    expect(turns[1]!.endedAt).toBe(turns[1]!.startedAt)
  })

  it('marks the soft usage warning as a limit too', () => {
    const t = new Transcript().prompt('go').raw({ type: 'assistant', usageLimitNote: 'wrap_up', message: { id: 'w', model: 'claude-opus-5-5', content: [] } })
    expect(turnsOf(t.entries(), false)[0]!.limited).toBe(true)
  })

  it('reads a human prompt from origin even when its text looks like a notification', () => {
    const t = new Transcript().prompt('<task-notification>', { origin: { kind: 'human' } }).say('ok')
    expect(turnsOf(t.entries(), false)[0]!.start).toBe('prompt')
  })
})
