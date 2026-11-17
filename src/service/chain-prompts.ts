import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withBrief, withMemory, withPrompts, withTracker, withUnbriefed, withVocabulary } from '../chain/relay.js'
import { MEMORY_SERVER } from '../memory/mcp.js'
import { ChangelogDrafts } from '../changelog/drafts.js'
import { DEFAULT_CHANGELOG } from '../changelog/file.js'
import { limitRefusalIn, spentLimitOf } from '../changelog/limit.js'
import { idPrefixOf, isPlain, projectLabel, type EvenKeelConfig } from '../config.js'
import type { Language } from '../language.js'
import { commitChangelog } from '../git/changelog.js'
import { runGit } from '../git/run.js'
import { fail } from '../notice/notice.js'
import { TASKS_SERVER } from '../taskmcp/server.js'
import type { TaskBrief } from '../tracker/source.js'
import { promptLines } from '../taskmcp/vocabulary.js'
import type { ChainContext } from './chain.js'
import { promptTrackers } from './vocabulary.js'
import type { LaunchBrief } from '../machine/port.js'

export function wireChangelogs(ctx: ChainContext): ChangelogDrafts {
  return new ChangelogDrafts({
    tasks: async (project, milestone) => {
      const link = ctx.linkOf(project)
      if (link === undefined) throw fail('tracker.noProject', { project })
      const tasks = await link.page(async (tracker) => tracker.milestoneTasks?.(project, milestone))
      if (tasks === undefined) throw fail('changelog.cannotList', { project })
      return tasks
    },
    write: async (project, prompt) => {
      const { account, model } = ctx.choiceFor(project)
      const home = ctx.homeOf(account)
      const agent = ctx.agentOf(home)
      if (agent.write === undefined) throw fail('changelog.noAgent', { project })
      const known = spentLimitOf(ctx.limits.limits(home.key), new Date())
      if (known !== null) {
        console.log(`changelog: ${project} draft not sent, the ${known.window ?? 'usage'} limit of ${home.key} is spent until ${known.until ?? 'unknown'}`)
        throw fail('changelog.limitSpent', { account: home.key, ...known })
      }
      console.log(`changelog: ${project} writes a draft on ${home.key}`)
      try {
        const { text, spend } = await agent.write(home, { cwd: ctx.configStore.current.projects[project]!, prompt, model, timeoutMs: ctx.CHANGELOG_TIMEOUT_MS })
        console.log(`changelog: ${project} draft on ${home.key} cost ${spend.cost === null ? 'unknown' : `$${spend.cost.toFixed(2)}`}`)
        return { text, spend: { ...spend, account: home.key } }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const refused = limitRefusalIn(detail)
        if (refused === null) throw fail('changelog.failed', { project }, { detail }, { cause: error })
        console.log(`changelog: ${project} draft refused on the limit of ${home.key}: ${detail}`)
        const until = spentLimitOf(ctx.limits.limits(home.key), new Date())?.until
        throw fail('changelog.limitSpent', { account: home.key, ...refused, ...(until !== undefined && { until }) })
      }
    },
    file: async (project) => {
      const path = ctx.configStore.current.settings[project]?.changelog ?? DEFAULT_CHANGELOG
      const file = join(ctx.configStore.current.projects[project]!, ...path.split('/'))
      const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      return { path, text: text?.replace(/\r\n/g, '\n') ?? null }
    },
    tags: async (project) => {
      if (isPlain(ctx.configStore.current, project)) return []
      const listed = await runGit(ctx.configStore.current.projects[project]!, ['tag', '--list'])
      return listed.code === 0 ? listed.out.split('\n').map((tag) => tag.trim()).filter(Boolean) : []
    },
    commit: async (project, path, message, change) => {
      if (isPlain(ctx.configStore.current, project)) throw fail('branch.noRepo', { project: projectLabel(ctx.configStore.current, project) })
      const sha = await commitChangelog(runGit, ctx.configStore.current.projects[project]!, { branch: ctx.branchOf(project), path, message, change })
      console.log(sha === null ? `changelog: ${project} ${path} is already as written` : `changelog: ${project} committed ${path} as ${sha.slice(0, 7)}`)
      return sha
    },
    db: ctx.db,
    now: () => new Date(),
  })
}

/** The hub's half: the brief of a task's launch, read from its tracker and sent with the launch's command. */
export interface Briefed {
  prepare(task: string, project?: string, retained?: boolean): Promise<LaunchBrief>
}

/** The machine's half: the brief a launch's command brought, kept for the task's later sessions and its tasks server. */
export interface LaunchBriefs {
  apply(task: string, given: string, received?: LaunchBrief): string
  kept(task: string): TaskBrief | undefined
}

/** Briefs kept for that many tasks at most: a day's chain never comes near it. */
const KEPT_BRIEFS = 200

export function wireBriefed(ctx: ChainContext): Briefed {
  const prepared = new Map<string, LaunchBrief>()
  const prepare = async (task: string, project = ctx.projectOf(task), retained = false): Promise<LaunchBrief> => {
    if (project === undefined) return { prompt: '' }
    const key = `${project}\u0000${task}`
    const previous = prepared.get(key)
    if (retained && previous !== undefined) return previous
    const reader = ctx.readerFor(project, task)
    const language = ctx.promptLanguage(project)
    const own = idPrefixOf(ctx.readers(), reader).toUpperCase()
    const vocabulary = promptLines(await promptTrackers(ctx, project), own)
    const prompt = withVocabulary(withTracker('', ctx.trackerPlace(reader), language), vocabulary, language)
    const link = ctx.briefOn(project, reader) ? ctx.linkOf(reader) : undefined
    const brief = link === undefined ? undefined : await link.run(async (tracker) => tracker.brief?.(task))
    const told = brief === undefined
      ? { prompt: withUnbriefed(prompt, task, ctx.packages.bringsServer(project, TASKS_SERVER), language) }
      : { prompt: withBrief(prompt, brief, language), task: brief }
    // The index stands in for the agent's own MEMORY.md, which a session with the memory server does not load (BTN-1029).
    const result = ctx.packages.bringsServer(project, MEMORY_SERVER)
      ? { ...told, prompt: withMemory(told.prompt, await ctx.memory.index(project), language) }
      : told
    prepared.delete(key)
    prepared.set(key, result)
    if (prepared.size > KEPT_BRIEFS) prepared.delete(prepared.keys().next().value!)
    return result
  }
  return { prepare }
}

export function launchBriefs(): LaunchBriefs {
  const kept = new Map<string, LaunchBrief>()
  return {
    apply: (task, given, received) => {
      if (received !== undefined) {
        kept.delete(task)
        kept.set(task, received)
        if (kept.size > KEPT_BRIEFS) kept.delete(kept.keys().next().value!)
      }
      return given + (kept.get(task)?.prompt ?? '')
    },
    kept: (task) => kept.get(task)?.task,
  }
}

export function wireWithProject(ctx: { configStore: { readonly current: EvenKeelConfig }; promptLanguage: (project?: string) => Language }): (prompt: string, project: string | undefined) => string {
  return (prompt: string, project: string | undefined): string => {
    const config = ctx.configStore.current
    const own = project === undefined ? null : (config.settings[project]?.prompt ?? null)
    return withPrompts(prompt, { shared: config.prompt, project: own }, ctx.promptLanguage(project))
  }
}
