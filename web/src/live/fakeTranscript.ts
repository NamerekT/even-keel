import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { EvenKeelState, SessionRecord, SessionView } from '../../../src/state.js'
import type { SessionCheckpoint } from '../../../src/stats/checkpoint.js'
import { fakeCalls, fakeManyShots, fakeOpenAsk, fakePastAsk, fakeShare, fakeShots } from './fakeChat.js'
import type { Ask } from '../../../src/sessions/ask.js'
import { ago, fakeFeed } from './fakeSessions.js'

export function fakeTranscript(open: Ask | null, shots: string | null): FeedLine[] {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  return [
    { at: at(40), kind: 'prompt', text: 'ABC-5\n\nWorking folder: C:\\repos\\example-project\\.claude\\worktrees\\abc-5' },
    { at: at(39), kind: 'text', text: 'Читаю описание задачи и вложения.' },
    { at: at(38), kind: 'tool', text: 'Bash Run the chain tests', detail: 'npx vitest run src/chain\nnpx tsc --noEmit', name: 'Bash', subject: 'Run the chain tests' },
    ...fakePastAsk(at),
    {
      at: at(30),
      kind: 'text',
      text: 'Порядок строится топологической сортировкой.\n\n- цикл сейчас роняет сервер;\n- сначала тест на цикл, потом правка.\n\n```\nError: cycle in the chain order: ABC-5 → ABC-7 → ABC-9 → ABC-5, the tasks of the cycle are left out of the order until a blocks link is removed\n    at chainOrder (C:\\repos\\example-project\\.claude\\worktrees\\abc-5\\src\\chain\\order.ts:42:11)\n```\n\nФайл `C:\\repos\\example-project\\.claude\\worktrees\\abc-5\\src\\chain\\order.ts`.\n\n' + 'Длинное объяснение. '.repeat(40),
    },
    ...fakeShots(at),
    ...(shots === 'many' || shots === 'gone' ? fakeManyShots(at, shots === 'gone') : []),
    { at: at(20), kind: 'prompt', text: 'А почему цикл не ловится раньше?' },
    ...fakeCalls(at),
    ...fakeShare(at),
    ...fakeFeed(),
    ...fakeOpenAsk(open),
  ]
}

export function fakeRecord(state: EvenKeelState, sessionId: string): SessionRecord | null {
  if (sessionId.endsWith('999')) return null
  const live = state.sessions.find((view) => view.sessionId === sessionId)
  return {
    sessionId,
    startedAt: live?.startedAt ?? ago(400),
    agent: live?.agent ?? 'claude',
    model: live?.model ?? 'claude-opus-5-5',
    effort: live === undefined ? 'high' : live.effort,
    lastActivityAt: live?.lastActivityAt ?? ago(250),
    contextTokens: live?.contextTokens ?? 271_000,
    contextWindow: live?.contextWindow ?? null,
    tokens: live?.tokens ?? { input: 192, output: 78_000, cacheRead: 17_400_000, cacheWrite: 243_000 },
    stage: 'test',
    feed: [...fakeFeed(), ...fakeFeed()],
    workdir: 'C:\\repos\\example-project\\.claude\\worktrees\\abc-5',
    branch: 'abc-5/chain-order',
    apiError: live?.apiError ?? "You've hit your session limit · resets 7:20pm (Europe/Berlin)",
    account: live?.account ?? state.taskSessions['ABC-5']?.find((row) => row.sessionId === sessionId)?.account ?? 'jane.roe@example.com',
  }
}

/** The thresholds the agent-bridge hook gets for a session: two thirds of its window, as a calibrated project might have. */
export function fakeCheckpoint(view: SessionView): SessionCheckpoint {
  const first = Math.round(((view.contextWindow ?? 200_000) * 2) / 3 / 1000) * 1000
  return { project: 'example', task: view.task, handoffs: 0, first, source: 'calibrated', late: null, hard: null, context: view.contextTokens, note: '.temp/handoff.md' }
}
