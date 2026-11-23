import type { CliSourceName } from '../agent/cli-state.js'
import { needsCheckedCli } from '../agent/providers.js'
import type { EvenKeelConfig } from '../config.js'
import type { BriefCopy } from './brief.js'

export const SELECTION_EVENT = 'machine.selection'
export type MachineSelection = { kind: 'cli' | 'active' | 'shared'; provider: string; value: string }
export type CliChoices = Record<string, { before: string | undefined; value: CliSourceName }>

/** Local CLI choices survive a restart; changes to the hub's desired choice supersede a local fallback. */
export class MachineConfig {
  constructor(
    private readonly brief: BriefCopy,
    private readonly cli: CliChoices,
    private readonly save: (choices: CliChoices) => void,
    private readonly select: (selection: MachineSelection) => void,
  ) {}

  get current(): EvenKeelConfig {
    const config = this.brief.configStore.current
    if (!this.brief.received) return config
    let changed = false
    for (const [provider, choice] of Object.entries(this.cli)) {
      if (config.cli[provider] !== choice.before) {
        delete this.cli[provider]
        changed = true
      }
    }
    if (changed) this.save({ ...this.cli })
    return { ...config, cli: { ...config.cli, ...Object.fromEntries(Object.entries(this.cli).map(([provider, choice]) => [provider, choice.value])) } }
  }

  saveCli(provider: string, value: CliSourceName): void {
    this.cli[provider] = { before: this.brief.configStore.current.cli[provider], value }
    this.save({ ...this.cli })
    this.select({ kind: 'cli', provider, value })
  }

  fallBackCli(provider: string): void {
    if (needsCheckedCli(provider, this.current.execution[provider])) {
      console.warn(`config: ${provider} stays on the checked CLI, execution ${this.current.execution[provider]} runs only on it`)
      return
    }
    this.saveCli(provider, 'system')
  }

  saveActive(provider: string, value: string): void {
    this.select({ kind: 'active', provider, value })
  }

  saveSharedAccount(provider: string, value: string): void {
    this.select({ kind: 'shared', provider, value })
  }
}
