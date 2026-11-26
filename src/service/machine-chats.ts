import { open, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { SessionStart } from '../agent/contract.js'
import { CLAUDE } from '../claude/name.js'
import { isPlain } from '../config.js'
import { TRANSCRIPT_PART_BYTES, type ChatStart, type MachineChats, type TranscriptPart } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import { replyParts } from '../sessions/ask.js'
import { typedText } from '../sessions/commandPrompt.js'
import type { MachineContext } from './machine-context.js'

export type MachineChatsContext = Pick<MachineContext,
  | 'agentOf'
  | 'agentStatus'
  | 'branchOf'
  | 'chatSettingsFor'
  | 'chatTitles'
  | 'configStore'
  | 'daemons'
  | 'homeOf'
  | 'launchIn'
  | 'liveView'
  | 'mailbox'
  | 'monitor'
  | 'packages'
  | 'resumeIn'
  | 'stopIn'
  | 'toldInbox'
>

/**
 * The machine's side of the project chats (BTN-1230, `docs/sessions/project-chats.md`): a chain session without a task
 * (BTN-1694) in the project's folder — the project's packages behind the gateway, not the account's or the folder's own
 * plugins and servers, the chat's own choice over the set (BTN-1696), and a Claude chat's own `--settings`
 * (`chatSettingsFor`). Every start takes the set current then.
 * The hub sends the whole choice with every call; the machine keeps nothing of a chat.
 */
export function wireMachineChats(ctx: MachineChatsContext): MachineChats {
  const startOf = (project: string, chat: string, folder: string, start: Omit<ChatStart, 'account'>, agent: string): SessionStart => {
    const config = ctx.configStore.current
    return {
      name: chat,
      cwd: folder,
      prompt: start.prompt,
      model: start.model,
      ...(start.effort === null ? {} : { effort: start.effort }),
      protection: config.settings[project]?.protection ?? config.protection,
      mainBranch: ctx.branchOf(project),
      ...(agent !== CLAUDE && config.execution[agent] === 'bypass' ? { bypassSandbox: true } : {}),
      ...(agent === CLAUDE ? { settings: ctx.chatSettingsFor(project, folder, start.packages ?? {}) } : {}),
      ...ctx.packages.chatStartOf(project, agent, start.packages ?? {}),
      ...(isPlain(config, project) ? { outsideRepo: true } : {}),
    }
  }
  const sessionOf = (chat: string) => {
    const session = ctx.monitor.handoff(chat)
    if (session === undefined) throw fail('chats.starting', {})
    return session
  }
  return {
    launch: async (project, folder, chat, start) => {
      const home = ctx.homeOf(start.account)
      await ctx.daemons.prepare(home)
      return ctx.launchIn(home, startOf(project, chat, folder, start, home.agent), project)
    },
    send: async (project, chat, start) => {
      const session = sessionOf(chat)
      const home = ctx.homeOf(session.account)
      const next = startOf(project, chat, session.cwd, start, home.agent)
      const hung = ctx.liveView(chat)?.hungSince != null
      const went = hung ? undefined : await ctx.agentOf(home).reply?.(home, session, next)
      if (went != null) return went
      // A live --bg session takes it through its inbox, mid-turn too (BTN-1345): the turn is never cut.
      if (!hung && (await ctx.toldInbox(chat, session, start.prompt))) return session.sessionId
      if (ctx.agentStatus(chat) === 'busy') {
        if (!hung && ctx.mailbox.listens(session.sessionId)) {
          const { text, files } = replyParts(start.prompt, null)
          ctx.mailbox.post(chat, session.sessionId, typedText(text), files)
          console.log(`chats: ${chat}: the message waits in the mailbox of the working session ${session.sessionId}`)
          return session.sessionId
        }
        console.log(`chats: ${chat}: refused the message because session ${session.sessionId} is busy (chats.busy)`)
        throw fail('chats.busy', {})
      }
      return ctx.monitor.holds.during(session.sessionId, async () => {
        await ctx.stopIn(home, session)
        await ctx.daemons.prepare(home)
        return ctx.resumeIn(home, session, next)
      }, ctx.liveView(chat)?.ask?.id ?? null)
    },
    stop: async (chat) => {
      const session = ctx.monitor.handoff(chat)
      if (session === undefined) return
      await ctx.stopIn(ctx.homeOf(session.account), session)
    },
    title: async (account, sessionId, chat) => {
      const home = ctx.homeOf(account)
      return home.agent === CLAUDE ? ctx.chatTitles.of(join(home.dir, 'projects'), sessionId, chat) : null
    },
    past: async (chat) => {
      const session = ctx.monitor.handoff(chat)
      return session === undefined ? null : { sessionId: session.sessionId, transcript: session.transcript, recent: session.recent }
    },
    transcriptPart: async (chat, from, length) => {
      const transcript = ctx.monitor.handoff(chat)?.transcript
      return transcript == null ? null : transcriptPartOf(transcript, from, length)
    },
  }
}

/** `length` bytes from `from` of the file, at most `TRANSCRIPT_PART_BYTES`, with its name and size; `null` — not readable. */
export async function transcriptPartOf(path: string, from: number, length: number): Promise<TranscriptPart | null> {
  let file: FileHandle
  try {
    file = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await file.stat()
    const wanted = Math.max(0, Math.min(length, TRANSCRIPT_PART_BYTES, size - from))
    const data = Buffer.alloc(wanted)
    const { bytesRead } = wanted === 0 ? { bytesRead: 0 } : await file.read(data, 0, wanted, from)
    return { name: basename(path), size, data: data.subarray(0, bytesRead).toString('base64') }
  } finally {
    await file.close()
  }
}
