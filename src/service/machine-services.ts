import { readFile } from 'node:fs/promises'
import type { HandoffSession } from '../chain/relay.js'
import { fromCarried, toCarried, type CarriedFile, type MachineServices } from '../machine/services.js'
import type { ServiceContext } from '../service.js'
import { inboxImage, saveInbox } from '../sessions/inbox.js'
import { deliveredMail } from '../sessions/mail.js'
import { noteWritten } from '../sessions/note.js'
import { sharedFile } from '../sessions/shareFile.js'

export type MachineServicesContext = Pick<ServiceContext,
  | 'account'
  | 'agentOf'
  | 'configStore'
  | 'emailAt'
  | 'homes'
  | 'inHomes'
  | 'mailbox'
  | 'monitor'
  | 'promptLanguage'
  | 'sessionAccount'
  | 'taskNote'
  | 'transcriptWatch'
>

export interface MachineServicesDeps {
  steer: (task: string, session: HandoffSession, prompt: string) => Promise<boolean>
  restore: MachineServices['records']['restore']
}

/** A file of the machine's disk, whole; `undefined` — gone, or not a file. */
const fileOf = (type: string, path: string): Promise<CarriedFile | undefined> =>
  readFile(path).then((data) => toCarried(type, data), () => undefined)

/**
 * The machine's own side of `MachineServices` (`docs/machines.md`, "The seam"): its accounts, the transcripts in its
 * account folders, and the mailbox and folders of its sessions.
 */
export function wireMachineServices(ctx: MachineServicesContext, deps: MachineServicesDeps): MachineServices {
  const mailOf = (sessionId: string) => deliveredMail(ctx.mailbox.delivered(sessionId), ctx.configStore.current.language ?? ctx.promptLanguage(), ctx.taskNote)
  const feedOf = (sessionId: string, mail = false) =>
    ctx.inHomes((home) => ctx.agentOf(home).feed(home, sessionId, 0, mail ? mailOf(sessionId) : undefined))
  return {
    account: ctx.account,
    transcript: {
      record: async (sessionId) => {
        for (const home of ctx.homes.list()) {
          const found = await ctx.agentOf(home).record(home, sessionId)
          if (found !== undefined) return {
            ...found,
            agent: home.agent,
            contextWindow: found.contextWindow ?? ctx.monitor.contextWindowOf(sessionId),
            account: ctx.sessionAccount(sessionId, found.startedAt) ?? ctx.emailAt(home.key, found.startedAt),
          }
        }
        return undefined
      },
      feed: (sessionId, after) =>
        ctx.inHomes(async (home) => {
          const agent = ctx.agentOf(home)
          const feed = await agent.feed(home, sessionId, after, mailOf(sessionId))
          if (feed !== undefined && agent.feedFile !== undefined) void ctx.transcriptWatch.keep(sessionId, () => agent.feedFile!(home, sessionId))
          return feed
        }),
      image: async (sessionId, tool, index) => {
        const image = await ctx.inHomes(async (home) => ctx.agentOf(home).image?.(home, sessionId, tool, index))
        return image === undefined ? undefined : { type: image.type, data: image.data }
      },
      inboxFile: async (sessionId, name) => {
        const feed = await feedOf(sessionId, true)
        const found = inboxImage(feed?.lines.flatMap((line) => line.files ?? []) ?? [], name)
        return found === undefined ? undefined : fileOf(found.type, found.path)
      },
      sharedFile: async (sessionId, tool, index) => {
        const feed = await feedOf(sessionId)
        const share = feed?.lines.find((line) => line.tool === tool && line.share !== undefined)?.share
        const found = share === undefined ? undefined : sharedFile(share, index)
        return found === undefined ? undefined : fileOf(found.type, found.path)
      },
      note: async (sessionId) => {
        const feed = await feedOf(sessionId)
        return feed === undefined ? null : noteWritten(feed.lines)
      },
      context: async (sessionId) => ({ context: ctx.monitor.contextOf(sessionId) ?? null, compactAt: ctx.monitor.compactAtOf(sessionId) }),
    },
    chat: {
      post: async (task, sessionId, text, files) => void ctx.mailbox.post(task, sessionId, text, files),
      dismiss: async (sessionId) => ctx.mailbox.dismiss(sessionId),
      steer: deps.steer,
      saveInbox: (_project, workdir, files) => saveInbox(workdir, files.map((file) => ({ name: file.name, data: fromCarried(file) }))),
    },
    records: { restore: deps.restore },
  }
}
