import { ranSince } from '../chain/launches.js'
import { isOwnName } from '../chain/fix.js'
import { saveQuestions } from '../chain/store.js'
import { parseRemote } from '../ci/remote.js'
import { intakeRepo } from '../intake/github.js'
import { Intake, type IntakePlace } from '../intake/intake.js'
import { idPrefixOf, ownerOf, projectLabel, readerIds, readersOf, readKeyOf, type EvenKeelConfig } from '../config.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import { profileFor } from '../profiles/model.js'
import { projectRules } from '../profiles/rules.js'
import { setStateValue } from '../storage/service-state.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { parseTaskId } from '../tracker/model.js'
import { TrackerQuestions, type AskingSession } from '../tracker/questions.js'
import { ReaderTasks } from '../tracker/readers.js'
import { startTracker } from '../tracker/start.js'
import { Trackers } from '../tracker/trackers.js'
import type { ServiceContext } from '../service.js'

type TrackersContext = Pick<ServiceContext,
  | 'CI_TIMEOUT_MS'
  | 'answerSession'
  | 'applyCi'
  | 'branchOf'
  | 'ciTokenOf'
  | 'ciWatches'
  | 'configStore'
  | 'configuredProject'
  | 'db'
  | 'dispatcher'
  | 'feedOf'
  | 'getState'
  | 'hub'
  | 'intakeEntries'
  | 'intakePlaces'
  | 'launches'
  | 'linkFor'
  | 'linkOf'
  | 'links'
  | 'liveView'
  | 'ownerOfReader'
  | 'packages'
  | 'postedQuestions'
  | 'profiles'
  | 'projectOf'
  | 'promptLanguage'
  | 'readerFor'
  | 'readerRules'
  | 'readerTasks'
  | 'readers'
  | 'refreshers'
  | 'remotes'
  | 'rulesClashes'
  | 'sessions'
  | 'tasksByProject'
  | 'trackers'
  | 'writes'
>

export function wireReaderRules(ctx: TrackersContext): (reader: string) => import("../chain/rules.js").ChainRules {
  return (reader: string) => {
    const project = ctx.ownerOfReader(reader)
    try {
      const rules = projectRules(ctx.configStore.current, ctx.profiles.current(), project, ctx.feedOf(reader))
      ctx.rulesClashes.delete(reader)
      return rules
    } catch (error) {
      const text = englishOf(noticeOf(error))
      if (ctx.rulesClashes.get(reader) !== text) console.log(`rules: the tracker profile's rules are left out: ${text}`)
      ctx.rulesClashes.set(reader, text)
      return ctx.configStore.current.rules[project]!
    }
  }
}

export function wireTrackers(ctx: TrackersContext): Trackers {
  return new Trackers({
    adapters: ADAPTERS,
    start: (view, setup) =>
      startTracker(view, setup, {
        repoOf: (reader) => ctx.configStore.current.projects[ctx.ownerOfReader(reader)]!,
        rulesOf: ctx.readerRules,
        links: ctx.links,
        tasksByProject: ctx.readerTasks,
        // A task launched through another profile is not this one's to ask for: the archive shows it (BTN-66).
        ranSince: (reader, since) => {
          const project = ctx.ownerOfReader(reader)
          const profile = profileFor(ctx.profiles.current(), reader, ctx.readers().trackers[reader]!)?.id
          const own = ctx.launches.filter((entry) => entry.profile === undefined || entry.profile === profile)
          return ranSince(own, project, since).filter((task) => ctx.readerFor(project, task) === reader)
        },
        dispatcher: ctx.readerTasks,
        fillsMilestone: (reader) => ctx.configStore.current.settings[ctx.ownerOfReader(reader)]?.fillMilestone ?? false,
        mainBranch: (reader) => ctx.branchOf(ctx.ownerOfReader(reader)),
        readKey: (reader) => readKeyOf(ctx.readers(), reader),
        broadcast: () => ctx.hub.broadcast('state', ctx.getState()),
        refreshers: ctx.refreshers,
      }),
    tasksByProject: ctx.readerTasks,
    refreshers: ctx.refreshers,
    log: (line) => console.log(line),
  })
}

export function wireQuestions(ctx: TrackersContext): TrackerQuestions {
  return new TrackerQuestions({
    sessions: () => {
      const current = ctx.dispatcher.state.active.flatMap((chain): AskingSession[] => {
        const sessionId = chain.current?.sessionId
        const view = sessionId == null ? undefined : ctx.liveView(chain.current!.task)
        if (view === undefined || view.sessionId !== sessionId || isOwnName(view.task)) return []
        return [{ project: chain.project, task: view.task, sessionId, ask: view.ask, current: true }]
      })
      const aside = ctx.sessions.flatMap((view): AskingSession[] => {
        const project = ctx.configuredProject(view.task)
        if (view.lamp === 'finished' || project === undefined || current.some((each) => each.sessionId === view.sessionId)) return []
        return [{ project, task: view.task, sessionId: view.sessionId, ask: view.ask, current: false }]
      })
      return [...current, ...aside]
    },
    tracker: (project, task, call) => ctx.linkFor(project, task)?.run(call),
    language: () => ctx.configStore.current.language ?? ctx.promptLanguage(),
    load: () => ctx.postedQuestions,
    save: (posted) => ctx.writes.add('the posted questions', saveQuestions(ctx.db, posted)),
    answer: (project, task, sessionId, ask, reply) => ctx.answerSession(project, task, sessionId, ask, { from: 'tracker', ...reply }),
    log: (message) => console.log(message),
  })
}

export function wireIntakePlaces(ctx: TrackersContext): () => IntakePlace[] {
  return (): IntakePlace[] =>
    Object.entries(ctx.configStore.current.settings).flatMap(([project, settings]) => {
      const label = settings.intakeLabel
      if (label === null || ctx.configStore.current.trackers[project] === 'github') return []
      for (const remote of ctx.remotes.urls[project] ?? []) {
        const parsed = parseRemote(remote.url)
        if (parsed?.host !== 'github.com') continue
        const { host: _, ...repo } = parsed
        const token = ctx.ciTokenOf(project, { kind: 'github', remote: remote.name, ...repo })?.token
        if (token === undefined) return []
        const slug = `${repo.owner}/${repo.repo}`
        return [{ project, slug, label, repo: intakeRepo(slug, token, ctx.CI_TIMEOUT_MS) }]
      }
      return []
    })
}

export function wireIntake(ctx: TrackersContext): Intake {
  return new Intake({
    places: ctx.intakePlaces,
    language: (project) => ctx.configStore.current.language ?? ctx.promptLanguage(project),
    create: async (project, task) => {
      const created = await ctx.linkOf(project)?.run(async (tracker) => tracker.create?.({ project, ...task, priority: 'medium', milestoneOf: null }))
      if (created == null) throw new Error(`the tracker of ${projectLabel(ctx.configStore.current, project)} is off or cannot create a task`)
      return created
    },
    comment: async (project, task, body) => {
      await ctx.linkFor(project, task)?.run(async (tracker) => tracker.comment?.(task, body))
    },
    task: async (project, task) => {
      const found = (await ctx.linkFor(project, task)?.run(async (tracker) => tracker.tasks([task])))?.find((each) => each.id === task)
      return found === undefined ? null : { category: found.status.category, milestone: found.milestone?.label ?? null }
    },
    load: () => ctx.intakeEntries,
    save: (entries) => ctx.writes.add('the issues taken in', setStateValue(ctx.db, 'intake', entries)),
    now: () => new Date(),
    log: (message) => console.log(message),
  })
}

export function projectsChanged(ctx: TrackersContext, before: EvenKeelConfig): void {
  const after = ctx.configStore.current
  for (const project of Object.keys(before.projects)) {
    if (Object.hasOwn(after.projects, project)) {
      if (before.keys[project] !== after.keys[project]) console.log(`config: ${before.keys[project]} is now ${projectLabel(after, project)}`)
      continue
    }
    ctx.dispatcher.forget(project)
    ctx.tasksByProject.delete(project)
    console.log(`config: ${projectLabel(before, project)} is gone from the config; its chain is let go, its sessions are left as they are`)
  }
  for (const project of Object.keys(after.projects)) if (!Object.hasOwn(before.projects, project)) console.log(`config: ${projectLabel(after, project)} joined`)
  ctx.trackers.apply(readersOf(after), ctx.profiles.current())
  if (JSON.stringify(before.projects) !== JSON.stringify(after.projects)) {
    void ctx.packages.projectsChanged().catch((error: unknown) => console.warn(`packages: ${(error as Error).message}`))
    ctx.applyCi()
  }
  const remoteProfiles = (config: EvenKeelConfig) => JSON.stringify(Object.entries(config.settings).map(([key, settings]) => [key, settings.remoteProfiles]))
  if (remoteProfiles(before) !== remoteProfiles(after)) ctx.ciWatches.tokensChanged()
}

export function configuredProject(ctx: TrackersContext, task: string): string | undefined {
  const listed = ctx.projectOf(task)
  if (listed !== undefined) return listed
  const prefix = parseTaskId(task)?.project
  const all = ctx.readers()
  const reader = Object.keys(all.projects).find((each) => idPrefixOf(all, each) === prefix)
  return reader === undefined ? undefined : ownerOf(all, reader)
}

export function wireReaderTasks(ctx: TrackersContext): ReaderTasks {
  return new ReaderTasks({
    owner: ctx.ownerOfReader,
    readers: (project) => readerIds(ctx.configStore.current, project),
    belongs: (reader, task) => ctx.readerFor(ctx.ownerOfReader(reader), task) === reader,
    tasksByProject: ctx.tasksByProject,
    get dispatcher() {
      return ctx.dispatcher
    },
  })
}
