import { fakeTask as trackerTask } from '../../../src/tracker/fixture.js'
import type { StatusCategory, Task } from '../../../src/tracker/model.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { ProjectTask, SessionView } from '../../../src/state.js'
import { FAKE_ASK } from './fakeChat.js'

export function task(
  id: string,
  title: string,
  name: string,
  category: StatusCategory,
  blockedBy: string[] = [],
  milestone: string | null = null,
  extra: Partial<Task> = {},
): ProjectTask {
  const made = trackerTask(id, {
    title,
    status: { name, category },
    blockedBy,
    milestone: milestone === null ? null : { label: milestone, targetDate: 0 },
    priority: 'medium',
    ...extra,
  })
  // The fake projects' ids are their keys.
  return { ...made, project: id.replace(/-\d+$/, '') }
}

export const minutes = (count: number) => count / 60

export function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** When the turn of every working fake session began: the turn line's clock runs on from it. */
export const turnStartedAt = ago(0.4)

function fakeSessionId(task: string): string {
  const [project = '', number = ''] = task.split('-')
  const projectHex = Array.from(project.slice(0, 4), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return `${projectHex.padStart(8, '0')}-0000-4000-8000-${number.replace(/\D/g, '').padStart(12, '0')}`
}

export function session(task: string, contextTokens: number, lamp: SessionView['lamp'] = 'working'): SessionView {
  return {
    task,
    sessionId: fakeSessionId(task),
    agent: 'claude',
    model: 'claude-opus-5-5',
    cwd: 'C:\\repos\\example-project',
    branch: `${task.toLowerCase()}/task`,
    lamp,
    checkpoint: false,
    waitingFor: lamp === 'waiting' && task !== 'ABC-5' ? 'permission' : null,
    startupDialog: null,
    hungSince: null,
    asking: lamp === 'waiting' && task === 'ABC-5',
    ask: lamp === 'waiting' && task === 'ABC-5' ? FAKE_ASK : null,
    apiError: null,
    startedAt: ago(42),
    lastActivityAt: ago(0),
    contextTokens,
    contextWindow: 250_000,
    cache: fakeCache(lamp),
    tokens: { input: 18_400, output: 9_200, cacheRead: 1_240_000, cacheWrite: 96_000 },
    stage: 'edit',
    action: { at: ago(0), kind: 'tool', text: 'Edit src/example.ts' },
    feed: fakeFeed(),
    remoteUrl: lamp === 'working' || lamp === 'waiting' ? 'https://claude.ai/code/session_example' : null,
    remoteOff: lamp === 'working' || lamp === 'waiting' ? null : 'no-bridge',
    account: task === 'ABC-6' ? 'jane.roe@example.com' : 'john.doe@example.com',
  }
}

function fakeCache(lamp: SessionView['lamp']): SessionView['cache'] {
  if (lamp === 'working') return { ttl: '1h', until: ago(-58) }
  if (lamp === 'waiting') return { ttl: '5m', until: ago(-2) }
  return { ttl: '1h', until: ago(20) }
}

export const FEED_STEPS: [FeedLine['kind'], string][] = [
  ['text', 'Читаю описание задачи и вложения.'],
  ['tool', 'huly get_issue ABC-5'],
  ['tool', 'Bash git checkout -b abc-5/chain-order'],
  ['tool', 'Read src/chain/order.ts'],
  ['tool', 'Grep blockedBy'],
  ['text', 'Порядок строится топологической сортировкой, цикл сейчас роняет сервер. Сначала тест на цикл.'],
  ['tool', 'Edit src/chain/order.test.ts'],
  ['tool', 'Bash npx vitest run src/chain'],
  ['tool', 'Edit src/chain/order.ts'],
  ['error', 'API Error: 529 overloaded, повтор через 4 с'],
]

export function fakeFeed(): FeedLine[] {
  return Array.from({ length: 30 }, (_, index) => {
    const [kind, text] = FEED_STEPS[index % FEED_STEPS.length]!
    return { at: new Date(Date.now() - (30 - index) * 25_000).toISOString(), kind, text }
  })
}
