import type { ServiceContext } from '../service.js'
import type { MachineContext } from './machine-context.js'
import { SWEEP_EVERY_MS } from '../builtin/files.js'
import { gitProjects } from '../config.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import { KEEP_WARM_TICK_MS } from '../sessions/keepwarm.js'
import { settleMail } from '../sessions/mailRelay.js'
import { VACUUM_EVERY_MS, vacuumDatabase } from '../storage/vacuum.js'
import * as cliCheckService from './cli-check.js'
import { CI_TARGETS_MS, CI_TICK_MS, FORWARD_TICK_MS, INTAKE_TICK_MS, LIMIT_CHECK_MS, WORK_TICK_MS } from './defaults.js'
import { assemblePollWorks } from './hub-bootstrap.js'

export function startTicks(ctx: ServiceContext, machine: MachineContext, sweepFiles: () => void, pollQuestions: () => void, pollIntake: () => void): void {
  setInterval(() => ctx.hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()
  setInterval(pollQuestions, 15_000).unref()
  setInterval(() => settleMail(ctx.mailRelay), 15_000).unref()
  
  setInterval(() => ctx.dispatcher.check(), LIMIT_CHECK_MS).unref()
  setInterval(() => void ctx.keepWarm.check(), KEEP_WARM_TICK_MS).unref()
  setInterval(sweepFiles, SWEEP_EVERY_MS).unref()
  setInterval(() => ctx.writes.add('the vacuum', vacuumDatabase(ctx.db)), VACUUM_EVERY_MS).unref()
  ctx.backups.start()
  setInterval(() => void ctx.cliChecks.check(), cliCheckService.CLI_CHECK_TICK_MS).unref()
  setInterval(() => void ctx.dispatcher.pollReviews().catch((error) => console.error(`review: the poll failed: ${englishOf(noticeOf(error))}`)), 60_000).unref()
  ctx.applyCi()
  setInterval(() => {
    for (const watch of ctx.ciWatches.all()) void watch.tick()
  }, CI_TICK_MS).unref()
  setInterval(() => void ctx.forwards.tick().catch(() => { }), FORWARD_TICK_MS).unref()
  setInterval(pollIntake, INTAKE_TICK_MS).unref()
  const pollWorks = assemblePollWorks(machine)
  pollWorks()
  setInterval(pollWorks, WORK_TICK_MS).unref()
  setInterval(
    () =>
      void Promise.all([ctx.ciWatches.refresh(), ctx.remotes.apply(gitProjects(ctx.configStore.current))]).then(([changed, moved]) => {
        if (changed || moved) ctx.dispatcher.check()
        if (changed || moved) ctx.stateChanged()
      }),
    CI_TARGETS_MS,
  ).unref()
  
}
