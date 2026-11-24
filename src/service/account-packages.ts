import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { sessionBase } from '../agent/env.js'
import { sharedMemory } from '../account/share.js'
import { CLAUDE } from '../claude/name.js'
import { writeHandoffNote } from '../chain/handoff-notes.js'
import { CODEX } from '../codex/name.js'
import { idPrefixOf, ownerOf, readerIds } from '../config.js'
import { home as dataHome, root } from '../locations.js'
import { MemoryHub } from '../memory/git/hub.js'
import { MemoryMcp } from '../memory/mcp.js'
import { databaseDirOf, memoryDirOf } from '../storage/owner.js'
import { Packages } from '../packages/service.js'
import { PackageHub } from '../packages/hub.js'
import { loadPackages } from '../packages/store.js'
import { emptyPackages } from '../packages/model.js'
import { keyPool, profileFor, serverProfile } from '../profiles/model.js'
import { TRACKER_GROUPS } from '../sessions/protection.js'
import { servesTasks, TASKS_SERVER, TasksMcp } from '../taskmcp/server.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { EditRefused } from '../tracker/editor.js'
import { runLabelText } from '../tracker/model.js'
import { installed } from '../updates/watcher.js'
import type { AccountsContext } from './accounts.js'
import { pinnable } from '../machine/pins.js'

/** The hub's memory repositories and its folders as their working copies (BTN-1646): one folder a project for now. */
export function wireMemory(ctx: Pick<AccountsContext, 'db' | 'configStore' | 'homes' | 'stateDir'>): MemoryHub {
  return new MemoryHub({
    db: ctx.db,
    dir: memoryDirOf(databaseDirOf(ctx.stateDir)),
    folders: () => Object.fromEntries(Object.entries(ctx.configStore.current.projects).map(([project, repo]) => [project, [sharedMemory(ctx.homes.global.dir, repo)]])),
    author: hostname(),
    log: (line) => console.log(line),
    mirror: () => ctx.configStore.current.memoryMirror,
  })
}

export function wirePackageHub(ctx: AccountsContext): PackageHub {
  return new PackageHub({
    memory: new MemoryMcp({ hub: ctx.memory }, installed(root).version),
    catalog: () => loadPackages(join(ctx.stateDir, 'packages.json')) ?? emptyPackages(),
    get repos() { return ctx.configStore.current.projects },
    rules: trackerKeyRules(),
    baseEnv: (): NodeJS.ProcessEnv => sessionBase(process.env, ctx.packages.keyNames(), ctx.envFile.own()),
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
        runOf: (project, task) => ctx.runOfTask(project, task),
        setRun: (project, task, run) => ctx.setTaskRun(project, task, run),
        poolMachines: (project) => {
          const network = ctx.machineLink.network
          const names = network.names()
          return pinnable(network.poolOf(project), network.live(), ctx.machineLink.own()).map((id) => ({ id, name: names[id] ?? id }))
        },
        machineNames: () => ctx.machineLink.network.names(),
        refresh: (project) => ctx.refreshProject(project),
        attachmentLimit: () => ctx.configStore.current.attachmentLimit * 1024 * 1024,
        editedOf: (reader, task) => ctx.readerTasks.get(reader)?.find((each) => each.id === task)?.edited,
        writeNote: (note) => writeHandoffNote(ctx.db, note),
        // The machine link is wired after the packages; a machine's call comes only over it.
        inPool: (machine, project) => ctx.machineLink.inPool(machine, project),
      },
      // `ctx.release` is set after the packages are wired.
      installed(root).version,
    ),
    log: (line) => console.log(line),
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
