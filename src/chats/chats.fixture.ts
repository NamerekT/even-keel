import type { ChatStart, MachineServices } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import { openDatabase, Writes } from '../storage/database.js'
import type { SessionView } from '../state.js'
import { ProjectChats, type ProjectChatsDeps } from './chats.js'
import type { ChatPast } from './prompt.js'
import { ChatStore } from './store.js'

export const OWN = 'machine-own'

export const view = (task: string, sessionId: string, fields: Partial<SessionView> = {}): SessionView => ({
  task,
  sessionId,
  agent: 'claude',
  model: 'claude-opus-5-5',
  effort: null,
  cwd: 'C:\\repos\\example-project',
  branch: 'main',
  lamp: 'waiting',
  checkpoint: false,
  waitingFor: null,
  startupDialog: null,
  hungSince: null,
  asking: false,
  ask: null,
  apiError: null,
  apiErrorKind: null,
  startedAt: '2026-11-18T10:00:00.000Z',
  lastActivityAt: '2026-11-18T10:00:30.000Z',
  contextTokens: 1_000,
  contextWindow: 200_000,
  cache: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  stage: null,
  action: null,
  feed: [],
  remoteUrl: null,
  remoteOff: null,
  account: 'john.doe@example.com',
  ...fields,
})

export interface SetupOptions {
  offline?: boolean
  stopFails?: boolean
  launchFails?: boolean
}

/** Project chats on a fresh database with one machine whose calls are recorded. */
export async function setup(options: SetupOptions = {}) {
  const db = await openDatabase(undefined)
  const writes = new Writes((line) => { throw new Error(line) })
  const store = await ChatStore.open({ db, writes })
  let clock = new Date('2026-11-18T10:00:00.000Z')
  let ids = 0
  const calls: Array<[string, ...unknown[]]> = []
  const sessions: SessionView[] = []
  const titles = new Map<string, string>()
  const pasts = new Map<string, ChatPast>()
  const switches = { offline: options.offline === true, launchFails: options.launchFails === true }
  const services: Pick<MachineServices, 'chat' | 'chats'> = {
    chat: {
      post: async () => {},
      giveBack: async () => {},
      dismiss: async () => {},
      steer: async () => false,
      tell: async () => false,
      saveInbox: async (_project, folder, files) => files.map((file) => `${folder}\\.temp\\inbox\\${file.name}`),
    },
    chats: {
      launch: async (project: string, folder: string, chat: string, start: ChatStart) => {
        calls.push(['launch', project, folder, chat, start])
        if (switches.launchFails) throw fail('chats.noMachine', {})
        return `session-${chat}`
      },
      send: async (project, chat, start) => {
        calls.push(['send', project, chat, start])
        return `session-${chat}`
      },
      stop: async (chat) => {
        calls.push(['stop', chat])
        if (options.stopFails === true) throw fail('chats.noMachine', {})
      },
      title: async (_account, sessionId) => titles.get(sessionId) ?? null,
      past: async (chat) => pasts.get(chat) ?? null,
    },
  }
  const deps: ProjectChatsDeps = {
    store,
    placeOf: async () => ({ machine: OWN, folder: 'C:\\repos\\example-project' }),
    services: (machine) => (machine === OWN && !switches.offline ? services : undefined),
    sessions: () => sessions,
    accounts: () => [{ key: 'global', agent: 'claude' }, { key: 'codex-work', agent: 'codex' }],
    language: () => 'en',
    changed: () => {},
    log: () => {},
    now: () => clock,
    newId: () => `chat-${String((ids += 1)).padStart(12, '0')}`,
  }
  const chats = new ProjectChats(deps)
  return {
    chats,
    deps,
    db,
    writes,
    store,
    calls,
    sessions,
    titles,
    pasts,
    switches,
    close: async () => {
      await writes.settled()
      await db.close()
    },
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  }
}
