import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type TrackerPlace } from '../chain/relay.js'
import { ciToken, gitlabUrls, projectTargets } from '../ci/adapters.js'
import { ProtectionAudit } from '../ci/protection-audit.js'
import { type CiTarget } from '../ci/remote.js'
import { gitProjects, readerIds, readerOf } from '../config.js'
import { EventLog, loadEventLog, pruneEventLog, saveEventEntry, saveEventMemory } from '../event-log/log.js'
import { runGit } from '../git/run.js'
import { stateDirOf } from '../locations.js'
import { importForgejo, importProfiles } from '../profiles/store.js'
import { type ChainControl } from '../server.js'
import type { ServiceContext } from '../service.js'
import type { MachineContext } from './machine-context.js'
import { dropRunImport, dropTaskRun, loadRunImports, loadTaskRuns, saveTaskRun } from '../sessions/runs-store.js'
import { TaskRuns, type TaskRun } from '../sessions/runs.js'
import { inferredTallyMode } from '../stats/mode.js'
import { Backups, copyOnThread } from '../storage/backup-schedule.js'
import { backupDirOf } from '../storage/backup.js'
import { ADAPTERS } from '../tracker/adapters.js'
import type { TrackerLink } from '../tracker/link.js'
import { profileStatusesOf } from '../tracker/statuses.js'
import { KeptReads, Vocabularies } from '../tracker/vocabulary.js'
import { wireBadges } from './badge.js'

export async function assembleEventLog(ctx: Pick<ServiceContext, 'db' | 'writes' | 'stateChanged'>) {
  return new EventLog(
    await loadEventLog(ctx.db),
    {
      save: (entry) => ctx.writes.add(`the event log entry ${entry.id}`, saveEventEntry(ctx.db, entry)),
      prune: (below) => ctx.writes.add('the old event log entries', pruneEventLog(ctx.db, below)),
      remember: (memory) => ctx.writes.add('the event log memory', saveEventMemory(ctx.db, memory)),
    },
    undefined,
    () => ctx.stateChanged(),
  )
}

export function assembleBackups(ctx: Pick<ServiceContext, 'db' | 'attachmentsDir' | 'configStore' | 'stateChanged'>) {
  return new Backups({
    db: ctx.db,
    files: ctx.attachmentsDir,
    settings: () => ({ dir: backupDirOf(stateDirOf(), ctx.configStore.current.backup.dir), keep: ctx.configStore.current.backup.keep }),
    run: copyOnThread,
    log: (line) => console.log(line),
    changed: () => ctx.stateChanged(),
  })
}

export async function assembleTrackerProfiles(ctx: Pick<ServiceContext, 'db' | 'configStore' | 'importedAdapters'>) {
  return importProfiles({
    db: ctx.db,
    env: process.env,
    adapters: ctx.importedAdapters,
    trackers: ctx.configStore.current.trackers,
    log: (line) => console.log(line),
  })
}

export async function assembleImportedProfiles(ctx: Pick<ServiceContext, 'db' | 'configStore' | 'trackerProfiles'>) {
  return importForgejo({
    db: ctx.db,
    env: process.env,
    webs: async () => {
      const targets = await Promise.all(Object.values(gitProjects(ctx.configStore.current)).map((repo) => projectTargets(runGit, repo, ctx.trackerProfiles.profiles).catch(() => [])))
      return targets.flat().flatMap((target) => (target.kind === 'forgejo' ? [target.web] : []))
    },
    log: (line) => console.log(line),
  })
}

export async function assembleTaskRuns(ctx: Pick<ServiceContext, 'db' | 'writes'>) {
  return new TaskRuns(await loadTaskRuns(ctx.db), await loadRunImports(ctx.db), {
    save: (run) => ctx.writes.add(`the run of ${run.task}`, saveTaskRun(ctx.db, run)),
    drop: (project, task) => ctx.writes.add(`the run of ${task}`, dropTaskRun(ctx.db, project, task)),
    imported: (project) => ctx.writes.add(`the moved run labels of ${project}`, dropRunImport(ctx.db, project)),
  })
}

export function assembleProtectionAudit(ctx: Pick<ServiceContext, 'configStore' | 'ciTokenOf' | 'profiles' | 'stateChanged'>) {
  return new ProtectionAudit({ config: () => ({ ...ctx.configStore.current, projects: gitProjects(ctx.configStore.current) }), git: runGit, token: (project, target) => ctx.ciTokenOf(project, target)?.token ?? null, gitlabUrls: () => gitlabUrls(ctx.profiles.current().profiles), changed: ctx.stateChanged })
}

export function assembleCiTokenOf(ctx: Pick<ServiceContext, 'profiles' | 'configStore'>) {
  return (project: string, target: CiTarget) =>
    ciToken(target, ctx.profiles.current(), project, ctx.configStore.current.trackers[project]!, ctx.configStore.current.settings[project]?.remoteProfiles)
}

export function assembleCiOn(ctx: Pick<ServiceContext, 'ciWatches' | 'ciTokenOf'>) {
  return (profileId: string, hidden: boolean) =>
    ctx.ciWatches
      .places(hidden)
      .filter(({ project, target }) => ctx.ciTokenOf(project, target)?.profile === profileId)
      .map(({ project, target }) => ({ project, remote: target.remote }))
}

export function assembleTallyMode(ctx: Pick<ServiceContext, 'configStore' | 'stateDir'>) {
  return () => ctx.configStore.current.tally ?? inferredTallyMode(process.env, existsSync(join(ctx.stateDir, 'tally', 'pgdata')))
}

export function assemblePinnedCheckpoint(ctx: Pick<ServiceContext, 'configStore'>) {
  return (project: string | undefined) =>
    project === undefined || ctx.configStore.current.settings[project] === undefined
      ? ctx.configStore.current.stats.checkpointTokens
      : ctx.configStore.current.settings[project].checkpointTokens
}

export function assembleReaderFor(ctx: Pick<ServiceContext, 'configStore'>) {
  return (project: string, task: string) => readerOf(ctx.configStore.current, project, task)
}

export function assembleFeedOf(ctx: Pick<ServiceContext, 'configStore' | 'ownerOfReader'>) {
  return (reader: string) => ctx.configStore.current.feeds[ctx.ownerOfReader(reader)]?.find((feed) => feed.id === reader)
}

export function assembleRulesOf(ctx: Pick<ServiceContext, 'readerRules' | 'readerFor'>) {
  return (project: string, task?: string) => ctx.readerRules(task === undefined ? project : ctx.readerFor(project, task))
}

export function assembleLinkOf(ctx: Pick<ServiceContext, 'trackers' | 'links'>) {
  return (reader: string): TrackerLink | undefined => {
    const key = ctx.trackers.keyOf(reader)
    return key === undefined ? undefined : ctx.links.get(key)
  }
}

export function assembleLinkFor(ctx: Pick<ServiceContext, 'linkOf' | 'readerFor'>) {
  return (project: string, task: string) => ctx.linkOf(ctx.readerFor(project, task))
}

export function assembleRefreshProject(ctx: Pick<ServiceContext, 'configStore' | 'refreshers'>) {
  return async (project: string): Promise<boolean> => {
    const found = readerIds(ctx.configStore.current, project).flatMap((reader) => ctx.refreshers.get(reader) ?? [])
    await Promise.all(found.map((refresh) => refresh()))
    return found.length > 0
  }
}

export function assembleVocabularies(ctx: Pick<ServiceContext, 'linkOf'>) {
  return new Vocabularies(async (project) => ctx.linkOf(project)?.aside(async (tracker) => tracker.vocabulary?.(project)))
}

export function assembleProfileStatuses(ctx: Pick<ServiceContext, 'profiles'>) {
  return new KeptReads((id) => profileStatusesOf(ADAPTERS, ctx.profiles.current(), id))
}

export function assembleKnownTask(ctx: Pick<ServiceContext, 'tasksByProject'>) {
  return (task: string) => [...ctx.tasksByProject.values()].flat().find((each) => each.id === task)
}

export function assembleMoveRunLabels(ctx: Pick<ServiceContext, 'tasksByProject' | 'taskRuns'>) {
  return (project: string): void => {
    const tasks = ctx.tasksByProject.get(project)
    if (tasks === undefined) return
    const moved = ctx.taskRuns.importLabels(project, tasks)
    if (moved.length > 0) console.log(`run labels moved into runs: ${moved.join(', ')}`)
  }
}

export function assembleRunOfTask(ctx: Pick<ServiceContext, 'moveRunLabels' | 'taskRuns'>) {
  return (project: string | undefined, task: string) => {
    if (project === undefined) return undefined
    ctx.moveRunLabels(project)
    return ctx.taskRuns.of(project, task)
  }
}

export function assembleRunsOfProject(ctx: Pick<ServiceContext, 'moveRunLabels' | 'taskRuns'>) {
  return (project: string) => {
    ctx.moveRunLabels(project)
    return ctx.taskRuns.ofProject(project)
  }
}

export function assembleSetTaskRun(ctx: Pick<ServiceContext, 'taskRuns' | 'stateChanged'>) {
  return (project: string, task: string, run: TaskRun | null): void => {
    ctx.taskRuns.set(project, task, run)
    ctx.stateChanged()
  }
}

export function assembleTrackerPlace(ctx: Pick<ServiceContext, 'readers'>) {
  return (reader: string): TrackerPlace | null => {
    const all = ctx.readers()
    const name = all.trackers[reader]!
    const place = all.trackerProjects[reader]
    return place === undefined ? null : { title: ADAPTERS[name]!.title, project: place }
  }
}

export function assembleBadges(ctx: Pick<ServiceContext, 'configStore' | 'getState' | 'stats' | 'agentsRead' | 'readerTasks' | 'archive'>) {
  return wireBadges({
    config: () => ctx.configStore.current,
    state: ctx.getState,
    period: (query) => ctx.stats.period(query),
    read: (project) => ctx.agentsRead && readerIds(ctx.configStore.current, project).every((reader) => ctx.readerTasks.has(reader)),
    closed: (project) => ctx.archive.filter((each) => each.project === project),
  })
}

export function assembleSWITCHES(ctx: Pick<ServiceContext, 'configStore'>): Partial<Record<keyof ChainControl, (on: boolean) => void>> {
  return {
    setUnattended: (on) => ctx.configStore.saveChainSwitches({ unattended: on }),
    setTrimTools: (on) => ctx.configStore.saveChainSwitches({ trimTools: on }),
  }
}

export function assembleStartChain(ctx: Pick<ServiceContext, 'branches' | 'dispatcher'>) {
  return async (project: string) => {
    await ctx.branches.refresh(project)
    return ctx.dispatcher.start(project)
  }
}

export function assembleChainControl(ctx: Pick<ServiceContext, 'dispatcher' | 'startChain' | 'SWITCHES'>): ChainControl {
  return new Proxy(ctx.dispatcher, {
    get: (target, key, receiver) => (key === 'start' ? ctx.startChain : (ctx.SWITCHES[key as keyof ChainControl] ?? Reflect.get(target, key, receiver))),
  })
}

export function assembleApplyCi(ctx: Pick<ServiceContext, 'ciWatches' | 'configStore' | 'remotes' | 'dispatcher' | 'stateChanged'>) {
  return () =>
    void Promise.all([ctx.ciWatches.apply(gitProjects(ctx.configStore.current)), ctx.remotes.apply(gitProjects(ctx.configStore.current))]).then(() => {
      ctx.dispatcher.check()
      ctx.stateChanged()
    })
}

/** The machine reads its task folders on its own clock; a project whose tasks the hub has not listed yet waits. */
export function assemblePollWorks(ctx: Pick<MachineContext, 'configStore' | 'works' | 'brief'>) {
  return () => {
    const projects = Object.keys(ctx.configStore.current.projects)
    ctx.works.keep(projects)
    for (const project of projects) if (ctx.brief.lists(project)) void ctx.works.poll(project)
  }
}
