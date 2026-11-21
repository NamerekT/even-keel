import { ContextWindows, type SavedWindow } from '../agent/windows.js'
import { projectLabel, sessionPrefixes } from '../config.js'
import { WINDOWS_EVENT } from '../machine/records.js'
import { isInside } from '../paths.js'
import { SessionMonitor } from '../sessions/monitor.js'
import { TranscriptOwners } from '../sessions/owners.js'
import { rareEvents } from '../sessions/rare.js'
import { TurnEnds } from '../sessions/turn-ends.js'
import type { SessionView } from '../state.js'
import { saveContextWindow } from '../storage/context-windows.js'
import type { MachineContext } from './machine-context.js'
import { pushOf } from './machine-chain.js'

export function wireOwners(ctx: MachineContext): TranscriptOwners {
  return new TranscriptOwners({
    homes: () => ctx.homes.list(),
    transcripts: (home) => ctx.agentOf(home).transcripts(home),
    rescanMs: ctx.OWNERS_RESCAN_MS,
    onChange: () => ctx.machineChanged(),
    onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
  })
}

/** `saved` — the windows measured before this start (BTN-946). */
export function wireContextWindows(ctx: MachineContext, saved: SavedWindow[] = []): ContextWindows {
  return new ContextWindows({
    saved,
    save: (window) => ctx.writes.add(`the context window of ${window.account} on ${window.model}`, saveContextWindow(ctx.machineDb, window)),
    probe: async (key, model, _task, settings) => {
      const home = ctx.homeOf(key)
      return (await ctx.agentOf(home).contextWindow?.(home, model, settings)) ?? null
    },
    stamp: async (key) => {
      const home = ctx.homeOf(key)
      return (await ctx.agentOf(home).windowStamp?.(home)) ?? ''
    },
    recheckMs: ctx.WINDOW_RECHECK_MS,
    onError: (error) => console.warn(`context window: ${error instanceof Error ? error.message : String(error)}`),
  })
}

/** `sessionWindows` — the sessions' windows kept before this start, oldest first (BTN-946); the service's come with `records.restore`. */
export function wireMonitor(ctx: MachineContext, sessionWindows: [string, number][] = []): SessionMonitor {
  rareEvents.projectOf = (session) => {
    const launched = ctx.journal.find((entry) => entry.sessionId === session.sessionId)
    const candidates = Object.entries(ctx.configStore.current.projects).filter(([, repo]) => isInside(session.cwd, repo))
    const project = launched?.project ?? (candidates.length === 1 ? candidates[0]![0] : undefined)
    return project === undefined ? undefined : projectLabel(ctx.configStore.current, project)
  }
  const turns = new TurnEnds()
  return new SessionMonitor({
    agentOf: ctx.agentOf,
    homes: () => ctx.homes.list(),
    emailOf: (key) => ctx.account.emailOf(key),
    apiKey: (key) => ctx.account.apiKey(key),
    longToken: (key) => ctx.account.longToken(key) !== undefined,
    keyLimits: (key) => ctx.account.apiKey(key) && !ctx.spendsByKey(key),
    projectKeys: () => sessionPrefixes(ctx.configStore.current),
    contextWindow: (key, model, task, settings) => (ctx.agentOf(ctx.homeOf(key)).contextWindow === undefined ? null : ctx.contextWindows.peek(key, model, task, settings)),
    sessionWindows,
    onSessionWindows: (windows) => ctx.writes.add(`the context windows of ${windows.length} sessions`, ctx.tell.record(WINDOWS_EVENT, { windows, at: Date.now() })),
    approval: (sessionId) => ctx.approvals.ask(sessionId),
    intervalMs: ctx.SESSION_POLL_MS,
    onAgents: (list) => {
      const before = JSON.stringify(ctx.account.view.loginBlock)
      ctx.agents = list
      ctx.keySpend.observe(list.flatMap((agent) => (agent.account === undefined ? [] : [{ account: agent.account, sessionId: agent.sessionId, busy: agent.status === 'busy' || agent.status === 'shell' }])))
      // Every tick, not only on a change of the views: a session in the task's folder may have none (BTN-616).
      void ctx.stopLingering()
      for (const agent of turns.ended(list)) {
        // Only a session Even Keel launched: a hand session's branch is pushed by its person.
        const launched = ctx.journal.findLast((entry) => entry.sessionId === agent.sessionId)
        if (launched !== undefined) ctx.writes.add(`the push of ${launched.task}`, pushOf(ctx, launched.project, launched.task, agent.cwd, true))
      }
      ctx.approvals.settle(new Set(list.filter((agent) => agent.status === 'waiting').map((agent) => agent.sessionId)))
      if (JSON.stringify(ctx.account.view.loginBlock) !== before) ctx.machineChanged()
    },
    onChange: (views) => {
      for (const view of views) {
        if (view.apiErrorKind === 'auth') {
          const refused = ctx.agents.find(agent => agent.sessionId === view.sessionId)?.account
          if (refused !== undefined) ctx.account.tokenRefused(refused, new Date().toISOString())
        }
        if (view.apiErrorKind !== 'model') continue
        if (ctx.sessions.some(before => before.sessionId === view.sessionId && before.apiErrorKind === 'model' && before.apiError === view.apiError)) continue
        const account = ctx.agents.find(agent => agent.sessionId === view.sessionId)?.account
        if (account !== undefined) ctx.models.invalidate(account)
      }
      ctx.sessions = views
      // Set with the views, not with the entries: the tick reads them after its entries, and `liveView` needs both.
      ctx.agentsRead = true
      ctx.logStartupDialogs(views)
      ctx.machineChanged()
      ctx.writes.add('the session monitor tick', ctx.tell.record('sessions.read', null))
    },
    onError: (error) => console.error(`sessions: ${error instanceof Error ? error.message : String(error)}`),
  })
}

export function logStartupDialogs(ctx: MachineContext, views: SessionView[]): void {
  for (const view of views) {
    if (view.startupDialog === null || ctx.wedgedSessions.has(view.sessionId)) continue
    ctx.wedgedSessions.add(view.sessionId)
    console.warn(`sessions: ${view.task} hangs on a Claude Code dialog before its first turn: ${view.startupDialog} (session ${view.sessionId}, ${view.cwd})`)
  }
  for (const view of views) {
    const key = `${view.sessionId}@${view.hungSince}`
    if (view.hungSince === null || ctx.wedgedSessions.has(key)) continue
    ctx.wedgedSessions.add(key)
    console.warn(`sessions: the turn of ${view.task} has written nothing since ${view.hungSince} and is taken for hung (session ${view.sessionId})`)
  }
}
