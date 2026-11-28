import type { Queryable } from '../../storage/database.js'
import { setStateValue, stateValue } from '../../storage/service-state.js'

/**
 * The machines whose `settings.json` and `CLAUDE.md` stay out of the global configuration's sync, "Own configuration" of
 * the machine's page (`config.own` in `service_state`, BTN-1745). Read once by `load`, kept here; a change is written at once.
 */
export class OwnConfigs {
  private machines: string[] = []

  constructor(private readonly db: Queryable) {}

  async load(): Promise<void> {
    const value = await stateValue(this.db, 'config.own')
    this.machines = Array.isArray(value) && value.every((each) => typeof each === 'string') ? value : []
  }

  has(machine: string): boolean {
    return this.machines.includes(machine)
  }

  async set(machine: string, on: boolean): Promise<void> {
    const next = this.machines.filter((each) => each !== machine)
    if (on) next.push(machine)
    await setStateValue(this.db, 'config.own', next)
    this.machines = next
  }
}
