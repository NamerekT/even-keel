import { describe, expect, it } from 'vitest'
import { parseEntry } from '../../src/sessions/entry.js'
import { DEFAULT_SIGN_RULES, findSigns, signKey, spansOf, type Sign, type SignRules } from './signs.js'
import type { TranscriptEntry } from './stream.js'

type Outcome = 'ok' | { error: string }

class Transcript {
  private readonly lines: string[] = []
  private n = 0
  private clock = Date.parse('2026-10-03T10:00:00.000Z')
  private last: string | null = null

  prompt(text: string, parent: string | null = this.last): string {
    return this.line({ type: 'user', parentUuid: parent, message: { role: 'user', content: text } })
  }

  say(text: string, agentId?: string): this {
    this.line({ type: 'assistant', agentId, message: { id: `m${this.n + 1}`, model: 'claude-opus-5-5', content: [{ type: 'text', text }] } })
    return this
  }

  call(name: string, input: Record<string, unknown>, outcome: Outcome = 'ok', agentId?: string): this {
    const id = `t${this.n + 1}`
    this.line({
      type: 'assistant',
      agentId,
      message: { id: `m${this.n + 1}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] },
    })
    const error = outcome === 'ok' ? undefined : outcome.error
    this.line({
      type: 'user',
      agentId,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: error !== undefined, content: error ?? 'fine' }] },
    })
    return this
  }

  bash(command: string, outcome: Outcome = 'ok', agentId?: string): this {
    return this.call('Bash', { command, description: 'Run something' }, outcome, agentId)
  }

  compact(): this {
    this.line({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' })
    return this
  }

  entries(): TranscriptEntry[] {
    return this.lines.map((line) => parseEntry(line)!)
  }

  private line(fields: Record<string, unknown>): string {
    const uuid = `u${++this.n}`
    this.clock += 1000
    this.lines.push(JSON.stringify({ parentUuid: this.last, ...fields, uuid, sessionId: 's1', timestamp: new Date(this.clock).toISOString() }))
    this.last = uuid
    return uuid
  }
}

const rules: SignRules = { ...DEFAULT_SIGN_RULES, noCommitReplies: 1000 }

function kinds(signs: Sign[]): string[] {
  return signs.map((sign) => `${sign.kind}:${sign.count}`)
}

describe('findSigns failures', () => {
  it('marks a run of failed tool calls', () => {
    const t = new Transcript().bash('npm test', { error: 'Exit code 1' }).bash('npm run x', { error: 'Exit code 2' })
    t.call('Read', { file_path: 'D:/a.ts' }, { error: 'File does not exist.' })
    const signs = findSigns(t.entries(), rules)
    expect(kinds(signs)).toEqual(['failures:3'])
    expect(signs[0]).toMatchObject({ agentId: null, fromUuid: 'u1', toUuid: 'u5', detail: 'Bash×2, Read: Exit code 1' })
  })

  it('does not count failures split by a success', () => {
    const t = new Transcript().bash('a', { error: 'x' }).bash('b', { error: 'x' }).bash('c').bash('d', { error: 'x' }).bash('e', { error: 'x' })
    expect(findSigns(t.entries(), rules)).toEqual([])
  })

  it('keeps the streams of the session and its subagents apart', () => {
    const t = new Transcript().bash('a', { error: 'x' }).bash('b', { error: 'x' }, 'agent1').bash('c', { error: 'x' })
    expect(findSigns(t.entries(), rules)).toEqual([])
  })
})

describe('findSigns denials', () => {
  it('marks a permission denial even alone', () => {
    const t = new Transcript().bash('rm -rf build', { error: "Permission for this action was denied. Ask the user." }).bash('ls')
    expect(findSigns(t.entries(), rules)).toMatchObject([{ kind: 'denied', count: 1, detail: 'Bash: Permission for this action was denied. Ask the user.' }])
  })
})

describe('findSigns repeats', () => {
  it('marks the same command run again without edits in between', () => {
    const t = new Transcript().bash('npm test').call('Read', { file_path: 'a.ts' }).bash('npm  test ')
    const signs = findSigns(t.entries(), rules)
    expect(signs).toMatchObject([{ kind: 'repeat', count: 2, fromUuid: 'u1', toUuid: 'u5', detail: 'npm test' }])
  })

  it('lets an edit reset the count', () => {
    const t = new Transcript().bash('npm test').call('Edit', { file_path: 'a.ts' }).bash('npm test')
    expect(findSigns(t.entries(), rules)).toEqual([])
  })
})

describe('findSigns rereads', () => {
  it('marks a file read many times, whatever the slashes and case', () => {
    const t = new Transcript()
    for (const path of ['D:\\p\\a.ts', 'd:/p/a.ts', 'D:/p/a.ts', 'D:/p/A.ts', 'D:/p/a.ts']) t.call('Read', { file_path: path, offset: 10 })
    t.call('Read', { file_path: 'D:/p/b.ts' })
    expect(findSigns(t.entries(), rules)).toMatchObject([{ kind: 'reread', count: 5, detail: 'd:/p/a.ts' }])
  })

  it('ignores a file read fewer times than the rule', () => {
    const t = new Transcript()
    for (let i = 0; i < 4; i++) t.call('Read', { file_path: 'a.ts' })
    expect(findSigns(t.entries(), rules)).toEqual([])
  })

  it('counts the reads of each stretch between compactions apart, as a new session would', () => {
    const t = new Transcript()
    for (let i = 0; i < 3; i++) t.call('Read', { file_path: 'a.ts' })
    t.compact()
    for (let i = 0; i < 3; i++) t.call('Read', { file_path: 'a.ts' })
    expect(kinds(findSigns(t.entries(), rules))).toEqual(['compact:1'])
  })

  it('still marks a file read many times after a compaction', () => {
    const t = new Transcript().call('Read', { file_path: 'a.ts' }).compact()
    for (let i = 0; i < 5; i++) t.call('Read', { file_path: 'a.ts' })
    expect(findSigns(t.entries(), rules)).toMatchObject([{ kind: 'compact' }, { kind: 'reread', count: 5, fromUuid: 'u4' }])
  })
})

describe('findSigns long stretches without a commit', () => {
  const short: SignRules = { ...DEFAULT_SIGN_RULES, noCommitReplies: 4 }

  it('marks the replies before a late commit, not after it', () => {
    const t = new Transcript().say('plan').bash('npm test').call('Edit', { file_path: 'a.ts' })
    t.bash('git -C D:/p commit -m "x"').say('done').bash('git status')
    expect(findSigns(t.entries(), short)).toMatchObject([{ kind: 'no_commit', count: 4, fromUuid: 'u1', toUuid: 'u6' }])
  })

  it('does not take a failed commit for a commit', () => {
    const t = new Transcript().bash('git commit -m x', { error: 'hook failed' }).say('a').say('b').say('c')
    expect(kinds(findSigns(t.entries(), short))).toEqual(['no_commit:4'])
  })

  it('leaves subagents out', () => {
    const t = new Transcript()
    for (let i = 0; i < 5; i++) t.say(`step ${i}`, 'agent1')
    expect(findSigns(t.entries(), short)).toEqual([])
  })
})

describe('findSigns markers', () => {
  it('marks a rewind: a second prompt on the same parent', () => {
    const t = new Transcript()
    t.say('ready')
    t.prompt('do X')
    t.bash('x')
    t.prompt('and then Y')
    expect(findSigns(t.entries(), rules)).toEqual([])

    t.prompt('do Y instead', 'u1')
    expect(findSigns(t.entries(), rules)).toMatchObject([{ kind: 'rewind', count: 1, fromUuid: 'u2', toUuid: 'u6', detail: 'do X' }])
  })

  it('marks compactions and hand-offs', () => {
    const t = new Transcript().say('a').compact().say('b')
    expect(kinds(findSigns(t.entries(), rules, 'checkpoint'))).toEqual(['handoff:1', 'compact:1'])
    expect(kinds(findSigns(t.entries(), rules, 'launch'))).toEqual(['compact:1'])
  })
})

describe('signKey', () => {
  it('changes with the rules and the launch reason', () => {
    const key = signKey(rules, 'launch')
    expect(signKey({ ...rules }, 'launch')).toBe(key)
    expect(signKey({ ...rules, repeatRun: 5 }, 'launch')).not.toBe(key)
    expect(signKey(rules, 'relay')).not.toBe(key)
    expect(signKey(rules, null)).not.toBe(key)
  })
})

describe('spansOf', () => {
  const sign = (kind: Sign['kind'], from: number, to: number, agentId: string | null = null): Sign => ({
    kind,
    agentId,
    fromUuid: `u${from}`,
    toUuid: `u${to}`,
    fromAt: `2026-10-03T10:00:${String(from).padStart(2, '0')}.000Z`,
    toAt: `2026-10-03T10:00:${String(to).padStart(2, '0')}.000Z`,
    count: 1,
    detail: '',
  })

  it('merges overlapping signs and attaches the markers inside', () => {
    const spans = spansOf('s1', [sign('failures', 1, 5), sign('repeat', 4, 9), sign('compact', 7, 7), sign('denied', 20, 20), sign('compact', 30, 30)])
    expect(spans.map(({ fromUuid, toUuid, kinds }) => ({ fromUuid, toUuid, kinds }))).toEqual([
      { fromUuid: 'u1', toUuid: 'u9', kinds: ['compact', 'failures', 'repeat'] },
      { fromUuid: 'u20', toUuid: 'u20', kinds: ['denied'] },
    ])
  })

  it('keeps agents apart and names a span by its bounds', () => {
    const [main, agent] = spansOf('s1', [sign('failures', 1, 5), sign('failures', 2, 6, 'agent1')])
    expect(main!.agentId).toBeNull()
    expect(agent!.agentId).toBe('agent1')
    expect(main!.id).toBe(spansOf('s1', [sign('failures', 1, 5)])[0]!.id)
    expect(main!.id).not.toBe(spansOf('s1', [sign('failures', 1, 6)])[0]!.id)
  })
})
