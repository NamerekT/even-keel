import { executionOfChoices, transportOf } from '../account/transport.js'
import { needsCheckedCli } from '../agent/providers.js'
import { CLAUDE } from '../claude/name.js'
import type { ServiceContext } from '../service.js'

type LifecycleContext = Pick<ServiceContext,
  | 'SHUTDOWN_MS'
  | 'account'
  | 'cliChecks'
  | 'cliVersions'
  | 'configStore'
  | 'envChanged'
  | 'envFile'
  | 'homes'
  | 'ledger'
  | 'limits'
  | 'listen'
  | 'monitor'
  | 'owners'
  | 'packages'
  | 'profiles'
  | 'readers'
  | 'saveAccounts'
  | 'server'
  | 'stateDb'
  | 'tally'
  | 'tallyMode'
  | 'trackers'
  | 'updater'
  | 'updates'
  | 'vscode'
  | 'writes'
>

export function start(ctx: LifecycleContext): void {
  if (ctx.ledger.transports !== undefined) {
    const choices = Object.entries(ctx.ledger.transports).flatMap(([key, transport]) => {
      const home = ctx.homes.find(key)
      return home?.agent === CLAUDE ? [{ key, transport, apiKey: ctx.homes.apiKeyOf(home) !== null }] : []
    })
    const { execution, moved } = executionOfChoices(choices)
    if (needsCheckedCli(CLAUDE, execution) && ctx.configStore.current.cli[CLAUDE] !== 'checked') ctx.configStore.saveCli(CLAUDE, 'checked')
    if (execution !== ctx.configStore.current.execution[CLAUDE]) ctx.configStore.saveExecution(CLAUDE, execution)
    console.log(`accounts: Claude sessions run by execution.claude ${execution}, from the transports the accounts had`)
    for (const each of moved) console.log(`accounts: ${each.key} ran its sessions on ${each.transport}, now on ${transportOf(CLAUDE, execution, each.apiKey)}`)
    void ctx.writes.settled().then(() => {
      const { transports: _, ...rest } = ctx.ledger
      ctx.saveAccounts(rest)
    })
  }
  ctx.monitor.start()
  void ctx.owners.scan()
  ctx.limits.start()
  ctx.updates.start()
  void ctx.updater.start().catch((error: unknown) => console.warn(`updates: ${(error as Error).message}`))
  ctx.cliVersions.start()
  ctx.account.start()
  ctx.vscode.start()
  ctx.configStore.watch()
  void ctx.packages.start()
  ctx.tally.start()
  if (ctx.configStore.current.tally === null && ctx.tallyMode() !== null) {
    ctx.configStore.saveTally(ctx.tallyMode()!)
    console.log(`tally: stats stay ${ctx.tallyMode()}, as they ran before the setting`)
  }
  ctx.envFile.subscribe((changed) => void ctx.envChanged(changed))
  ctx.envFile.watch()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      ctx.cliChecks.stop()
      setTimeout(() => process.exit(0), ctx.SHUTDOWN_MS).unref()
      void Promise.allSettled([ctx.tally.stop(), ctx.writes.settled().then(() => ctx.stateDb.close())]).finally(() => process.exit(0))
    })
  }
  ctx.server.listen(ctx.listen.port, ctx.listen.host, () => {
    console.log(`even-keel listening on http://${ctx.listen.host}:${ctx.listen.port}`)
  })
  ctx.trackers.apply(ctx.readers(), ctx.profiles.current())
  ctx.profiles.start()
}
