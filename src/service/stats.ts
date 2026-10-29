import { join } from 'node:path'
import { accountsRoot, codexAccountsRoot, copilotAccountsRoot, openCodeAccountsRoot } from '../account/homes.js'
import { firstByKey, idPrefixOf } from '../config.js'
import { envTargets } from '../env-file.js'
import { home as dataHome, root } from '../locations.js'
import { defaultProfile, profileFor } from '../profiles/model.js'
import { StatsReader } from '../stats/reader.js'
import { tallyKey } from '../stats/mode.js'
import { TallyService } from '../stats/tally.js'
import type { ServiceContext } from '../service.js'

type StatsContext = Pick<ServiceContext,
  | 'TALLY_FIRST_DELAY_MS'
  | 'TALLY_INTERVAL_MS'
  | 'account'
  | 'applyGuard'
  | 'applyTally'
  | 'configStore'
  | 'dispatcher'
  | 'getState'
  | 'homes'
  | 'hub'
  | 'limits'
  | 'listen'
  | 'newTally'
  | 'owners'
  | 'pinnedCheckpoint'
  | 'profiles'
  | 'readers'
  | 'rebind'
  | 'stateDir'
  | 'stats'
  | 'tally'
  | 'tallyMode'
  | 'tallyRestarts'
  | 'tallyRuns'
>

export function wireNewTally(ctx: StatsContext): () => TallyService {
  return () =>
    new TallyService({
      mode: ctx.tallyMode(),
      root,
      home: dataHome,
      stateDir: ctx.stateDir,
      env: process.env,
      intervalMs: ctx.TALLY_INTERVAL_MS,
      firstDelayMs: ctx.TALLY_FIRST_DELAY_MS,
      evenKeelUrl: () => `http://${['0.0.0.0', '::'].includes(ctx.listen.host) ? '127.0.0.1' : ctx.listen.host}:${ctx.listen.port}`,
      huly: () => {
        const set = ctx.profiles.current()
        const config = ctx.readers()
        // By the Huly project, which Tally knows the tasks by; a feed is a reader of its own (BTN-66).
        const projects = Object.entries(config.trackers).flatMap(([project, kind]) => {
          const values = kind === 'huly' ? profileFor(set, project, kind)?.values : undefined
          return values === undefined ? [] : [[idPrefixOf(config, project), values] as const]
        })
        const elsewhere = Object.entries(config.trackers).flatMap(([project, kind]) => (kind === 'huly' ? [] : [idPrefixOf(config, project)]))
        const byId = Object.fromEntries(set.profiles.filter((profile) => profile.kind === 'huly').map((profile) => [profile.id, profile.values]))
        return { projects: Object.fromEntries(projects), fallback: defaultProfile(set, 'huly')?.values ?? null, elsewhere, byId }
      },
      log: (message) => console.log(message),
      changed: () => ctx.hub.broadcast('state', ctx.getState()),
    })
}

export function wireStats(ctx: StatsContext): StatsReader {
  return new StatsReader(
    ctx.tally.reader,
    () => Object.fromEntries(Object.entries(firstByKey(ctx.configStore.current)).map(([key, project]) => [key, ctx.configStore.current.projects[project]!])),
    () => ctx.configStore.current.stats,
    (key) => ctx.pinnedCheckpoint(firstByKey(ctx.configStore.current)[key]),
  )
}

export function applyTally(ctx: StatsContext): Promise<void> {
  ctx.tallyRestarts = ctx.tallyRestarts
    .then(async () => {
      const key = tallyKey(ctx.tallyMode(), process.env)
      if (key === ctx.tallyRuns) return
      ctx.tallyRuns = key
      await ctx.tally.stop()
      ctx.tally = ctx.newTally()
      ctx.stats.setReader(ctx.tally.reader)
      ctx.tally.start()
      console.log('tally: the stats mode or database changed, the collector starts anew')
      ctx.hub.broadcast('state', ctx.getState())
    })
    .catch((error: unknown) => console.error(`tally: ${(error as Error).message}`))
  return ctx.tallyRestarts
}

export async function envChanged(ctx: StatsContext, changed: string[]): Promise<void> {
  console.log(`env: ${changed.join(', ')} changed in .env`)
  const targets = envTargets(changed)
  if (targets.accounts) {
    ctx.homes.setRoots(accountsRoot(process.env), codexAccountsRoot(process.env), openCodeAccountsRoot(process.env), copilotAccountsRoot(process.env))
    ctx.account.refresh()
    ctx.limits.refresh()
    void ctx.owners.scan()
  }
  if (targets.guard) ctx.applyGuard()
  if (targets.listen) await ctx.rebind()
  if (targets.tally) await ctx.applyTally()
  ctx.dispatcher.check()
  ctx.hub.broadcast('state', ctx.getState())
}
