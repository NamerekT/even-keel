import { join } from 'node:path'
import type { SessionStart } from '../agent/contract.js'
import { CLAUDE } from '../claude/name.js'
import { isPlain } from '../config.js'
import type { ChatStart, MachineChats } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import type { MachineContext } from './machine-context.js'

export type MachineChatsContext = Pick<MachineContext,
  | 'agentOf'
  | 'agentStatus'
  | 'branchOf'
  | 'chatTitles'
  | 'configStore'
  | 'daemons'
  | 'homeOf'
  | 'launchIn'
  | 'liveView'
  | 'monitor'
  | 'resumeIn'
  | 'stopIn'
>

/**
 * The machine's side of the project chats (BTN-1230, `docs/sessions/project-chats.md`): a session started like a hand
 * one, in the project's folder with the account folder's own plugins and MCP servers, without the chain's packages,
 * `--settings` or trimmed tools. The hub sends the whole choice with every call; the machine keeps nothing of a chat.
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
      return ctx.monitor.holds.during(session.sessionId, async () => {
        const went = ctx.liveView(chat)?.hungSince != null ? undefined : await ctx.agentOf(home).reply?.(home, session, next)
        if (went != null) return went
        // A turn under way is never cut for a message: the user waits for its answer (invariant 1).
        if (ctx.agentStatus(chat) === 'busy') throw fail('chats.busy', {})
        await ctx.stopIn(home, session)
        await ctx.daemons.prepare(home)
        return ctx.resumeIn(home, session, next)
      }, null)
    },
    stop: async (chat) => {
      const session = ctx.monitor.handoff(chat)
      if (session === undefined) return
      await ctx.stopIn(ctx.homeOf(session.account), session)
    },
    title: async (account, sessionId) => {
      const home = ctx.homeOf(account)
      return home.agent === CLAUDE ? ctx.chatTitles.of(join(home.dir, 'projects'), sessionId) : null
    },
  }
}
