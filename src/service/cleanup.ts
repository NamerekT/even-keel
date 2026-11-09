import { isCallTimeout } from '../claude/calls.js'
import { runGit } from '../git/run.js'
import { slotPaths } from '../git/slot.js'
import { removeLeftFolder, taskPlace, type Git } from '../git/worktree.js'
import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import { isInside } from '../paths.js'
import { isLive, type AgentEntry } from '../sessions/agents.js'
import { rareEvents } from '../sessions/rare.js'
import type { ChainContext } from './chain.js'

/** How long a cleanup after Done keeps trying a stop that timed out in the folder's queue before it warns (EKR-99). */
export const STOP_RETRY_MS = 5 * 60_000

/**
 * Stops the task's sessions that are not mid-turn; the rest are kept in `lingering`, to be stopped once their turn ends
 * (BTN-616). A stop that timed out waiting for the account folder's queue is kept too, to be tried again (EKR-99):
 * `retrying` says so, and the cleanup then leaves the worktree folder the session holds to `deferLeftFolder`.
 */
export async function stopTaskSessions(
  ctx: ChainContext,
  project: string,
  repo: string,
  task: string,
  count: number,
): Promise<{ warnings: Notice[]; retrying: boolean }> {
  const own = new Set(ctx.launches.filter((entry) => entry.task === task).map((entry) => entry.sessionId))
  const slots = slotPaths(repo, count)
  const sessions = ctx.agents.filter(
    (agent) =>
      agent.id !== undefined &&
      isLive(agent) &&
      (isInside(agent.cwd, taskPlace(repo, task).path) || (slots.some((slot) => isInside(agent.cwd, slot)) && own.has(agent.sessionId))),
  )
  const warnings: Notice[] = []
  let retrying = false
  for (const agent of sessions) {
    if (midTurn(agent)) {
      ctx.lingering.keep(task, agent.sessionId, undefined, project)
      rareEvents.once('17c', 'deferred', { ...agent, task, project },
        `cleanup-deferred status=${agent.status}; will stop the session once its turn ends`)
      continue
    }
    try {
      await ctx.stopIn(ctx.homeOf(agent.account ?? 'global'), { agentId: agent.id!, sessionId: agent.sessionId })
    } catch (error) {
      if (!isCallTimeout(error)) {
        warnings.push(notice('cleanup.sessionNotStopped', { session: agent.sessionId }, { cause: noticeOf(error) }))
        continue
      }
      ctx.lingering.keep(task, agent.sessionId, { project, until: Date.now() + STOP_RETRY_MS })
      retrying = true
      console.log(`cleanup: the stop of the session ${agent.sessionId} of ${task} timed out, it will be tried again: ${englishOf(noticeOf(error))}`)
    }
  }
  return { warnings, retrying }
}

/**
 * The cleanup's warnings without the worktree folder a process still holds: a session whose stop is tried again
 * (EKR-99), or one just stopped whose process or children have not let go yet (BTN-870). The folder is tried again on
 * each tick once no kept session of the task is left, and warned about only if it is still held after `STOP_RETRY_MS`.
 */
export function deferLeftFolder(ctx: ChainContext, project: string, repo: string, task: string, warnings: Notice[]): Notice[] {
  return warnings.filter((warning) => {
    if (warning.code !== 'cleanup.folderLeft') return true
    ctx.lingering.leave({ project, task, repo, path: warning.params.path, until: Date.now() + STOP_RETRY_MS })
    console.log(`cleanup: the worktree folder ${warning.params.path} of ${task} is held, it will be tried again once nothing holds it`)
    return false
  })
}

/**
 * Stops the sessions a cleanup after Done left mid-turn whose turn has ended since, tries again the stops that timed
 * out, and removes the folders they held (`stopTaskSessions`). What still fails once the wait is over is warned about
 * on the task, as the cleanup itself would have.
 */
export function stopLingering(ctx: ChainContext, git: Git = runGit): Promise<void> {
  return ctx.lingering.alone(async () => {
    for (const { task, agent, retry, project } of ctx.lingering.due(ctx.agents, midTurn)) {
      if (agent.id === undefined) continue
      try {
        await ctx.stopIn(ctx.homeOf(agent.account ?? 'global'), { agentId: agent.id, sessionId: agent.sessionId })
        if (project !== undefined) rareEvents.once('17c', 'stop-result', { ...agent, task, project }, 'cleanup-stop result=stopped; the turn after Done ended')
        console.log(`cleanup: stopped the session ${agent.sessionId} of ${task}, ${retry === undefined ? 'its turn after Done ended' : 'its stop tried again'}`)
      } catch (error) {
        if (retry !== undefined && isCallTimeout(error) && Date.now() < retry.until) {
          ctx.lingering.keep(task, agent.sessionId, retry)
          continue
        }
        console.warn(`cleanup: the session ${agent.sessionId} of ${task} was not stopped: ${englishOf(noticeOf(error))}`)
        if (project !== undefined) rareEvents.once('17c', 'stop-result', { ...agent, task, project },
          `cleanup-stop result=failed detail=${JSON.stringify(englishOf(noticeOf(error)))}; leaving the session as before`)
        if (retry !== undefined) ctx.dispatcher.leftover(retry.project, task, notice('cleanup.sessionNotStopped', { session: agent.sessionId }, { cause: noticeOf(error) }))
      }
    }
    // The folders a previous run left wait for the first read of the sessions, as the cleanup itself does (BTN-646).
    if (ctx.agentsRead) ctx.lingering.wake()
    for (const folder of ctx.lingering.dueFolders(Date.now())) {
      const left = await removeLeftFolder(git, folder.repo, folder.path)
      if (left === null) {
        ctx.lingering.settle(folder)
        console.log(`cleanup: removed the worktree folder ${folder.path} of ${folder.task} once nothing held it`)
        continue
      }
      // A stopped process lets go of the folder a moment after it exits, its children later still (BTN-870).
      if (left.code === 'cleanup.folderLeft' && Date.now() < folder.until) {
        ctx.lingering.again(folder)
        continue
      }
      ctx.lingering.settle(folder)
      console.warn(`git: ${folder.task}: ${englishOf(left)}`)
      ctx.dispatcher.leftover(folder.project, folder.task, left)
    }
  })
}

export function midTurn(agent: AgentEntry): boolean {
  return agent.status === 'busy' || agent.status === 'waiting'
}
