import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withBrief, withPrompts, withTracker, withVocabulary } from '../chain/relay.js'
import { ChangelogDrafts } from '../changelog/drafts.js'
import { DEFAULT_CHANGELOG } from '../changelog/file.js'
import { idPrefixOf, isPlain, projectLabel } from '../config.js'
import { commitChangelog } from '../git/changelog.js'
import { runGit } from '../git/run.js'
import { fail } from '../notice/notice.js'
import { promptLines } from '../taskmcp/vocabulary.js'
import type { ChainContext } from './chain.js'
import { promptTrackers } from './vocabulary.js'

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
      console.log(`changelog: ${project} writes a draft on ${home.key}`)
      try {
        const { text, spend } = await agent.write(home, { cwd: ctx.configStore.current.projects[project]!, prompt, model, timeoutMs: ctx.CHANGELOG_TIMEOUT_MS })
        console.log(`changelog: ${project} draft on ${home.key} cost ${spend.cost === null ? 'unknown' : `$${spend.cost.toFixed(2)}`}`)
        return { text, spend: { ...spend, account: home.key } }
      } catch (error) {
        throw fail('changelog.failed', { project }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
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

export function wireBriefed(ctx: ChainContext): (task: string, given: string, project?: string | undefined) => Promise<string> {
  return async (task: string, given: string, project = ctx.projectOf(task)): Promise<string> => {
    if (project === undefined) return given
    const reader = ctx.readerFor(project, task)
    const language = ctx.promptLanguage(project)
    const own = idPrefixOf(ctx.readers(), reader).toUpperCase()
    const vocabulary = promptLines(await promptTrackers(ctx, project), own)
    const prompt = withVocabulary(withTracker(given, ctx.trackerPlace(reader), language), vocabulary, language)
    if (!ctx.briefOn(project, reader)) return prompt
    const link = ctx.linkOf(reader)
    return link === undefined ? prompt : withBrief(prompt, await link.run(async (tracker) => tracker.brief?.(task)), ctx.promptLanguage(project))
  }
}

export function wireWithProject(ctx: ChainContext): (prompt: string, project: string | undefined) => string {
  return (prompt: string, project: string | undefined): string => {
    const config = ctx.configStore.current
    const own = project === undefined ? null : (config.settings[project]?.prompt ?? null)
    return withPrompts(prompt, { shared: config.prompt, project: own }, ctx.promptLanguage(project))
  }
}
