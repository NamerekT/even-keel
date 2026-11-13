import { builtinControl, builtinPlaces } from '../builtin/control.js'
import { BuiltinStore } from '../builtin/store.js'
import { forgetProjectRows } from '../chain/store.js'
import { runSettings } from '../config.js'
import { DEMO_ACCOUNT, DEMO_AGENT } from '../demo/model.js'
import { DemoService } from '../demo/service.js'
import { runGit } from '../git/run.js'
import type { RunSettings } from '../sessions/launch.js'
import type { ServiceContext } from '../service.js'

type DemoContext = Pick<ServiceContext,
  | 'account'
  | 'archive'
  | 'chainControl'
  | 'configStore'
  | 'db'
  | 'dispatcher'
  | 'getState'
  | 'homes'
  | 'hub'
  | 'launches'
  | 'mergeMarks'
  | 'taskRuns'
  | 'promptLanguage'
  | 'refreshProject'
  | 'stateDir'
  | 'writes'
>

/** The demo project runs on the demo's agent and account, whatever the settings say: no config row names them. */
const DEMO_RUN: RunSettings = { provider: DEMO_AGENT, models: {}, accounts: { [DEMO_AGENT]: DEMO_ACCOUNT } }

/** The run settings of a project, the demo's own for the demo project (BTN-776). */
export function runOf(ctx: Pick<ServiceContext, 'configStore' | 'demo'>, project: string | undefined): RunSettings {
  return ctx.demo.owns(project) ? DEMO_RUN : runSettings(ctx.configStore.current, project)
}

export function wireDemo(ctx: DemoContext): DemoService {
  const chainOn = (project: string) => ctx.dispatcher.state.active.some((chain) => chain.project === project) || ctx.dispatcher.state.queue.includes(project)
  const demo = new DemoService({
    stateDir: ctx.stateDir,
    git: runGit,
    config: () => ctx.configStore.current,
    language: () => ctx.configStore.current.language ?? ctx.promptLanguage(),
    addProject: (draft, own) => ctx.configStore.addProject(draft, own),
    removeProject: (project) => ctx.configStore.removeProject(project),
    builtin: builtinControl({ db: ctx.db, places: () => builtinPlaces(ctx.configStore.current), refresh: (project) => ctx.refreshProject(project) }),
    store: () => new BuiltinStore(ctx.db),
    startChain: (project) => ctx.chainControl.start(project),
    stopChain: (project) => ctx.chainControl.stop(project),
    chainOn,
    homes: ctx.homes,
    refreshAccounts: () => ctx.account.refresh(),
    forgetRows: async (project) => {
      await ctx.writes.settled()
      await forgetProjectRows(ctx.db, project)
      for (const list of [ctx.launches, ctx.archive]) {
        for (let at = list.length - 1; at >= 0; at--) if (list[at]!.project === project) list.splice(at, 1)
      }
      ctx.mergeMarks.forget(project)
      ctx.taskRuns.forget(project)
    },
    changed: () => ctx.hub.broadcastSoon('state', ctx.getState),
  })
  // The end card shows once every task is closed and the chain let go: read as often as the event log reads the state.
  ctx.hub.watch('state', () => void demo.check().catch((error: unknown) => console.warn(`demo: ${error instanceof Error ? error.message : String(error)}`)), 2_000)
  return demo
}
