import { homedir } from 'node:os'
import { join } from 'node:path'
import { sessionBase } from '../agent/env.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { idPrefixOf, ownerOf, readerIds } from '../config.js'
import { home as dataHome, root } from '../locations.js'
import { Packages } from '../packages/service.js'
import { keyPool, profileFor, serverProfile } from '../profiles/model.js'
import { TRACKER_GROUPS } from '../sessions/protection.js'
import { servesTasks, TASKS_SERVER, TasksMcp } from '../taskmcp/server.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { EditRefused } from '../tracker/editor.js'
import { runLabelText } from '../tracker/model.js'
import { installed } from '../updates/watcher.js'
import type { AccountsContext } from './accounts.js'

export function wirePackages(ctx: AccountsContext): Packages {
  return new Packages({
    file: join(ctx.stateDir, 'packages.json'),
    cache: join(ctx.stateDir, 'packages'),
    envFile: join(dataHome, '.env'),
    get repos() {
      return ctx.configStore.current.projects
    },
    globalDir: ctx.homes.global.dir,
    ownDir: root,
    skillsDir: join(ctx.stateDir, 'skills'),
    skillRoots: () => [
      { dir: join(ctx.homes.global.dir, 'skills'), from: CLAUDE },
      { dir: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills'), from: CODEX },
      { dir: join(homedir(), '.agents', 'skills'), from: CODEX },
    ],
    claudeConfigs: ctx.claudeConfigs,
    rules: trackerKeyRules(),
    tracker: (project) => {
      const adapter = ADAPTERS[ctx.configStore.current.trackers[project]!]!
      const server = adapter.mcpServer
      if (server === undefined) return undefined
      return { server, required: !ctx.briefOn(project), ...(server !== TASKS_SERVER && servesTasks(adapter) ? { also: TASKS_SERVER } : {}) }
    },
    agentOf: (project) => ctx.homes.find(ctx.choiceFor(project).account)?.agent ?? CLAUDE,
    updateMarketplace: (marketplace) => ctx.agentOf(ctx.homes.global).updateMarketplace!(ctx.homes.global, marketplace, ctx.PLUGIN_UPDATE_TIMEOUT_MS),
    addMarketplace: (dir) => ctx.agentOf(ctx.homes.global).addMarketplace!(ctx.homes.global, dir, ctx.PLUGIN_UPDATE_TIMEOUT_MS),
    baseEnv: (): NodeJS.ProcessEnv => sessionBase(process.env, ctx.packages.keyNames()),
    poolOf: (project) => keyPool(ctx.profiles.current(), ctx.profileKindsOf, process.env, project, ctx.configStore.current.trackers[project]!, ctx.configStore.current.feeds[project]),
    oauth: (project, server, url) => ctx.profiles.gateway(serverProfile(ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!, ctx.configStore.current.feeds[project] ?? [], server)?.id, server, url),
    refuseDeletes: (project, server) => {
      const [tracker, adapter] = Object.entries(ADAPTERS).find(([, each]) => each.mcpServer === server) ?? []
      const { disabled } = ctx.configStore.current.settings[project]?.protection ?? ctx.configStore.current.protection
      const group = tracker === undefined ? undefined : TRACKER_GROUPS[tracker]
      return group === undefined || disabled.includes(group) ? undefined : adapter!.title
    },
    tasks: new TasksMcp(
      {
        db: ctx.db,
        run: async (reader, call, write) => {
          const link = ctx.linkOf(reader)
          if (link === undefined) throw new EditRefused("the project's tracker is off in Even Keel; turn it on on the page")
          return write === undefined ? link.run(call) : link.write(call, write)
        },
        // By the prefix of the task keys: a Huly project may read another identifier than its own key (BTN-892).
        readers: (project) => {
          const readers = ctx.readers()
          return readerIds(ctx.configStore.current, project).map((id) => ({ id, project, prefix: idPrefixOf(readers, id).toUpperCase() }))
        },
        readerOfPrefix: (prefix) => {
          const readers = ctx.readers()
          const id = Object.keys(readers.projects).find((each) => idPrefixOf(readers, each).toUpperCase() === prefix && servesTasks(ADAPTERS[readers.trackers[each]!]))
          return id === undefined ? null : { id, project: ownerOf(readers, id), prefix }
        },
        rulesOf: (reader) => ctx.readerRules(reader),
        modelOf: (_project, task) => {
          const ofTask = ctx.sessions.filter((each) => each.task === task)
          const live = ofTask.find((each) => each.lamp !== 'finished') ?? ofTask[0]
          return live === undefined ? null : runLabelText({ provider: live.agent, model: live.model })
        },
        refresh: (project) => ctx.refreshProject(project),
        // A chain session attaches files of its worktree; a hand session, of its project's repository (BTN-895).
        folderOf: (scope, project) => {
          const own = scope.task === null ? undefined : ctx.sessions.find((each) => each.task === scope.task && each.lamp !== 'finished' && each.cwd !== '')
          return own?.cwd ?? ctx.configStore.current.projects[project] ?? null
        },
        attachmentLimit: () => ctx.configStore.current.attachmentLimit * 1024 * 1024,
      },
      // `ctx.release` is set after the packages are wired.
      installed(root).version,
    ),
    port: ctx.mcpPort,
    log: (line) => console.log(line),
    onChange: () => {
      ctx.dispatcher.check()
      ctx.hub.broadcastSoon('state', ctx.getState)
    },
  })
}

export function briefOn(ctx: AccountsContext, project: string, reader = project): boolean {
  const own = ctx.configStore.current.briefs[project]
  if (own === true || (own === false && reader === project)) return own
  const tracker = ctx.readers().trackers[reader]!
  const adapter = ADAPTERS[tracker]!
  const { mcpServer: server, keepsBrief } = adapter
  if (server === undefined || keepsBrief === true) return true
  // The tasks server stands in for the tracker's own (BTN-882), for a feed too: it reads the feed on the feed's profile (BTN-892).
  const tasks = servesTasks(adapter) && ctx.packages.bringsServer(project, TASKS_SERVER)
  if (!ctx.packages.bringsServer(project, server)) return !tasks
  if (reader === project || tasks) return false
  const { trackers, feeds } = ctx.configStore.current
  const set = ctx.profiles.current()
  return serverProfile(set, project, trackers[project]!, feeds[project] ?? [], tracker)?.id !== profileFor(set, reader, tracker)?.id
}
