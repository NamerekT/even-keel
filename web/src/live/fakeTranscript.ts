import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { EvenKeelState, SessionRecord } from '../../../src/state.js'
import { fakeCalls, fakeOpenAsk, fakePastAsk, fakeShare, fakeShots } from './fakeChat.js'
import type { Ask } from '../../../src/sessions/ask.js'
import { ago, fakeFeed } from './fakeSessions.js'

export function fakeTranscript(open: Ask | null): FeedLine[] {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  return [
    { at: at(40), kind: 'prompt', text: 'ABC-5\n\nWorking folder: C:\\repos\\example-project\\.claude\\worktrees\\abc-5' },
    { at: at(39), kind: 'text', text: 'Читаю описание задачи и вложения.' },
    { at: at(38), kind: 'tool', text: 'Bash Run the chain tests', detail: 'npx vitest run src/chain\nnpx tsc --noEmit', name: 'Bash', subject: 'Run the chain tests' },
    ...fakePastAsk(at),
    {
      at: at(30),
      kind: 'text',
      text: 'Порядок строится топологической сортировкой.\n\n- цикл сейчас роняет сервер;\n- сначала тест на цикл, потом правка.\n\n' + 'Длинное объяснение. '.repeat(40),
    },
    ...fakeShots(at),
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
