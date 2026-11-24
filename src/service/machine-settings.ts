import type { ProjectSettings } from '../state.js'
import type { MachineProjectSettings, ServerOverride } from '../link/view.js'
import { fail } from '../notice/notice.js'
import type { Queryable } from '../storage/database.js'

/** The command lists a machine may have of its own in a project (BTN-994). */
export const MACHINE_COMMANDS = ['beforeStart', 'check', 'afterGreen'] as const
export type MachineCommand = (typeof MACHINE_COMMANDS)[number]

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

function overrideOf(raw: unknown): ServerOverride | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('machines.badSettings', {})
  const { command, args } = raw as Record<string, unknown>
  if ((command !== undefined && typeof command !== 'string') || (args !== undefined && !isStrings(args))) throw fail('machines.badSettings', {})
  const text = command?.trim() ?? ''
  const list = args?.map((arg) => arg.trim()).filter((arg) => arg !== '') ?? []
  if (text === '' && list.length === 0) return undefined
  return { ...(text !== '' && { command: text }), ...(list.length > 0 && { args: list }) }
}

/**
 * A machine's values as the page sent them or the database keeps them, with nothing empty left: an empty command list
 * or a server with neither command nor arguments is the project's. A wrong shape is refused.
 */
export function cleanMachineSettings(raw: unknown): MachineProjectSettings {
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('machines.badSettings', {})
  const input = raw as Record<string, unknown>
  const settings: MachineProjectSettings = {}
  for (const key of MACHINE_COMMANDS) {
    const value = input[key]
    if (value === undefined) continue
    if (!isStrings(value)) throw fail('machines.badSettings', {})
    const lines = value.map((line) => line.trim()).filter((line) => line !== '')
    if (lines.length > 0) settings[key] = lines
  }
  if (input.afterGreenOff !== undefined && typeof input.afterGreenOff !== 'boolean') throw fail('machines.badSettings', {})
  if (input.afterGreenOff === true) {
    delete settings.afterGreen
    settings.afterGreenOff = true
  }
  if (input.servers !== undefined) {
    if (typeof input.servers !== 'object' || input.servers === null || Array.isArray(input.servers)) throw fail('machines.badSettings', {})
    const servers: NonNullable<MachineProjectSettings['servers']> = {}
    for (const [name, byServer] of Object.entries(input.servers)) {
      if (typeof byServer !== 'object' || byServer === null || Array.isArray(byServer)) throw fail('machines.badSettings', {})
      for (const [server, override] of Object.entries(byServer)) {
        const clean = overrideOf(override)
        if (clean !== undefined) (servers[name] ??= {})[server] = clean
      }
    }
    if (Object.keys(servers).length > 0) settings.servers = servers
  }
  return settings
}

/** The column as kept: `null` for a machine with nothing of its own. */
export function settingsColumn(settings: MachineProjectSettings): string | null {
  return Object.keys(settings).length === 0 ? null : JSON.stringify(settings)
}

/** The column read back; a value that does not parse is nothing of the machine's own. */
export function settingsFromColumn(text: string | null): MachineProjectSettings {
  if (text === null) return {}
  try {
    return cleanMachineSettings(JSON.parse(text))
  } catch {
    return {}
  }
}

/** A machine's own values in a project; `{}` — none, or the machine is not in its pool. */
export async function machineSettingsOf(db: Queryable, project: string, machine: string): Promise<MachineProjectSettings> {
  const { rows } = await db.query<{ settings: string | null }>('select settings from project_machines where project_id = $1 and machine_id = $2', [project, machine])
  return settingsFromColumn(rows[0]?.settings ?? null)
}

/** The project's settings as they run on a machine: each command list of its own in place of the project's. */
export function settingsOnMachine(project: ProjectSettings, own: MachineProjectSettings): ProjectSettings {
  const replaced = MACHINE_COMMANDS.filter((key) => (own[key]?.length ?? 0) > 0)
  const lists = Object.fromEntries(replaced.map((key) => [key, own[key]!]))
  if (own.afterGreenOff === true) lists.afterGreen = []
  return Object.keys(lists).length === 0 ? project : { ...project, ...lists }
}

/** The commands after a green main a machine runs: none when it turned them off, else its own, else the project's. */
export function afterGreenOn(project: Pick<ProjectSettings, 'afterGreen'> | undefined, own: MachineProjectSettings): string[] {
  if (own.afterGreenOff === true) return []
  return (own.afterGreen?.length ?? 0) > 0 ? own.afterGreen! : (project?.afterGreen ?? [])
}
