import { TRANSCRIPT_PART_BYTES, type ChatStart, type MachineServices } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import { openDatabase, Writes } from '../storage/database.js'
import type { SessionView } from '../state.js'
import { ProjectChats, type ProjectChatsDeps } from './chats.js'
import type { ChatPast } from './prompt.js'
import { ChatStore } from './store.js'

export const OWN = 'machine-own'
/** A machine elsewhere of the project's pool, with the project in its own folder. */
export const FAR = 'machine-far'
export const FAR_FOLDER = '/home/john/example-project'

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
  /** The `chatSessions` ceiling; 3 by default. */
  ceiling?: number
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
  /** The transcript files of the chats' sessions on the own machine; `size` — told instead of the data's own. */
  const transcripts = new Map<string, { name: string; data: Buffer; size?: number }>()
  /** The transcript reads and the inbox saves, with the machine each went to. */
  const carried: Array<[string, 'part' | 'save', ...unknown[]]> = []
  /** `down` — the machines off the link besides all of them with `offline`. */
  const switches = { offline: options.offline === true, down: new Set<string>(), launchFails: options.launchFails === true, stopFails: options.stopFails === true, ceiling: options.ceiling ?? 3 }
  const logged: string[] = []
  const servicesOf = (machine: string): Pick<MachineServices, 'chat' | 'chats'> => ({
    chat: {
      post: async () => {},
      giveBack: async () => {},
      dismiss: async () => {},
      steer: async () => false,
      tell: async () => false,
      saveInbox: async (_project, folder, files) => {
        carried.push([machine, 'save', folder, ...files.map((file) => [file.name, Buffer.from(file.data, 'base64').toString()])])
        return files.map((file) => `${folder}\\.temp\\inbox\\${file.name}`)
      },
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
        if (switches.stopFails) throw fail('chats.noMachine', {})
      },
      title: async (_account, sessionId) => titles.get(sessionId) ?? null,
      past: async (chat) => pasts.get(chat) ?? null,
      transcriptPart: async (chat, from, length) => {
        carried.push([machine, 'part', chat, from, length])
        const file = transcripts.get(chat)
        if (file === undefined || machine !== OWN) return null
        return { name: file.name, size: file.size ?? file.data.length, data: file.data.subarray(from, from + Math.min(length, TRANSCRIPT_PART_BYTES)).toString('base64') }
      },
    },
  })
  const deps: ProjectChatsDeps = {
    store,
    placeOf: async (_project, machine) => {
      if (machine === undefined || machine === OWN) return { machine: OWN, folder: 'C:\\repos\\example-project' }
      if (machine === FAR) return { machine: FAR, folder: FAR_FOLDER }
      throw fail('chats.notInPool', {})
    },
    machines: async () => ({ machines: [], picked: OWN }),
    services: (machine) => ((machine === OWN || machine === FAR) && !switches.offline && !switches.down.has(machine) ? servicesOf(machine) : undefined),
    machineName: (machine) => (machine === OWN ? 'Workstation' : machine === FAR ? 'Laptop' : machine),
    sessions: () => sessions,
    accounts: () => [{ key: 'global', agent: 'claude' }, { key: 'codex-work', agent: 'codex' }],
    language: () => 'en',
    changed: () => {},
    log: (line) => void logged.push(line),
    ceiling: () => switches.ceiling,
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
    transcripts,
    carried,
    switches,
    logged,
    close: async () => {
      await writes.settled()
      await db.close()
    },
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  }
}
