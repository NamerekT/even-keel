import { join } from 'node:path'
import { liveSessions } from '../account/model.js'
import { AGENTS } from '../agent/adapters.js'
import { sessionBase } from '../agent/env.js'
import { runCliCheck, CHECK_MODELS } from '../cli-check/run.js'
import { CliChecks, type CheckAgent, type CheckHistory } from '../cli-check/scheduler.js'
import { runSettings } from '../config.js'
import { setStateValue } from '../storage/service-state.js'
import type { ServiceContext } from '../service.js'

type CliCheckContext = Pick<ServiceContext,
  | 'account'
  | 'agentOf'
  | 'cliLease'
  | 'configStore'
  | 'db'
  | 'dispatcher'
  | 'getState'
  | 'homes'
  | 'hub'
  | 'packages'
  | 'runtimes'
  | 'stateDir'
  | 'writes'
>

/** How often the service looks whether a check is due; the latest version itself is asked at most every 6 hours. */
export const CLI_CHECK_TICK_MS = 10 * 60_000

/** The account folder each agent is checked in: the first one a project runs its sessions on by its provider. */
export function checkAgents(ctx: CliCheckContext): CheckAgent[] {
  const config = ctx.configStore.current
  const found = new Map<string, CheckAgent>()
  for (const project of Object.keys(config.projects)) {
    const { provider, accounts } = runSettings(config, project)
    const home = ctx.homes.find(accounts[provider] ?? '')
    const adapter = AGENTS[provider]
    if (found.has(provider) || home?.agent !== provider || adapter === undefined || !ctx.runtimes.has(provider)) continue
    found.set(provider, { name: provider, title: adapter.title, checked: adapter.checked, home })
  }
  return [...found.values()]
}

export function wireCliChecks(ctx: CliCheckContext, history: CheckHistory): CliChecks {
  return new CliChecks({
    enabled: () => ctx.configStore.current.cliCheck,
    ready: () => ctx.account.ready,
    agents: () => checkAgents(ctx),
    latest: (agent) => AGENTS[agent]!.latest(),
    live: async (home) => liveSessions(await ctx.agentOf(home).sessions(home), home.key).length > 0,
    run: async ({ agent, version, home }) => {
      try {
        await runCliCheck({
          agent,
          home,
          version,
          model: CHECK_MODELS[agent] ?? null,
          usage: false,
          work: join(ctx.stateDir, 'cli-check'),
          env: () => sessionBase(process.env, ctx.packages.keyNames()),
          say: (line) => console.log(`cli-check: ${line}`),
        })
      } finally {
        // The check stopped the folder's daemon: the next launch starts one on the pinned version.
        ctx.dispatcher.check()
      }
    },
    lease: ctx.cliLease,
    history,
    accountLabel: (home) => ctx.account.view.accounts.find((entry) => entry.key === home.key)?.name ?? home.key,
    save: async (next) => ctx.writes.add('the CLI check history', setStateValue(ctx.db, 'cliCheck.history', next)),
    now: () => Date.now(),
    changed: () => ctx.hub.broadcast('state', ctx.getState()),
    log: (line) => console.log(line),
  })
}
