import type { DraftMachine, FolderProbe, MachineCard, MachineView, ProjectDraft, SourceRead } from '../../../src/state.js'
import { cloneTyped, type WizardFields } from './projectWizard.js'

/** A machine's row of the wizard's block "Machines" (BTN-1297); kept as typed while it is unticked. */
export interface MachinePick {
  on: boolean
  /** The folder's name in the machine's folder of projects; blank — the hub's folder name. */
  folder: string
  /** "Another folder…": `path` is the folder's full path on the machine instead. */
  other: boolean
  path: string
}

export const NEW_PICK: MachinePick = { on: false, folder: '', other: false, path: '' }

/** A machine of the hub as the block lists it: its card with the system and the folder of projects it reported. */
export interface WizardMachine {
  id: string
  name: string
  color: string
  own: boolean
  online: boolean
  offlineSince: number | null
  /** `process.platform` and its release; `null` — not reported. */
  os: string | null
  /** The machine's folder of projects; the hub's is not asked: its folder is the wizard's own. */
  root: string | null
  /** The agents it has a signed-in account of. */
  agents: string[]
}

/** The hub first, then each joined machine, from the header's cards and the machines' reports; the hub's system is the page's. */
export function wizardMachines(cards: MachineCard[], views: MachineView[], platform: string): WizardMachine[] {
  const rows = cards.map((card): WizardMachine => {
    const about = card.own ? null : (views.find((each) => each.id === card.id)?.about ?? null)
    return {
      id: card.id,
      name: card.name,
      color: card.color,
      own: card.own,
      online: card.own || card.online,
      offlineSince: card.offlineSince,
      os: card.own ? platform : (about?.os ?? null),
      root: about?.root ?? null,
      agents: card.agents,
    }
  })
  return [...rows.filter((each) => each.own), ...rows.filter((each) => !each.own)]
}

/** The block shows for a git project on a hub with a machine elsewhere; else the hub's folder line stands alone. */
export const blockShown = (fields: Pick<WizardFields, 'git'>, machines: WizardMachine[]): boolean => fields.git && machines.some((each) => !each.own)

/**
 * The remote a machine elsewhere takes the project through: the address typed, or the remote of a checkout already
 * there; `null` — a new folder or a checkout without one, so the project stays on the hub.
 */
export function remoteOf(fields: Pick<WizardFields, 'git' | 'target'>, read: SourceRead | null): string | null {
  if (!fields.git) return null
  if (cloneTyped(fields)) return fields.target.trim() || null
  return read?.as === 'existing' ? (read.remote?.url ?? null) : null
}

/** Whether a machine's row can be ticked, and why not. */
export type RowState = 'open' | 'offline' | 'noRemote' | 'noRoot'

export function rowState(machine: WizardMachine, remote: string | null): RowState {
  if (machine.own) return 'open'
  if (!machine.online) return 'offline'
  if (remote === null) return 'noRemote'
  return machine.root === null ? 'noRoot' : 'open'
}

/** A root written with backslashes, or a bare drive (`D:`), joins with backslashes; `D:/Projects` keeps its slashes. */
export const separatorOf = (root: string): string => (root.includes('\\') || /^[A-Za-z]:$/.test(root) ? '\\' : '/')

/** A name, slashes and all, under a machine's folder of projects, in that machine's way of writing paths. */
export function joinOnMachine(root: string, name: string): string {
  const separator = separatorOf(root)
  const parts = name.split(/[\\/]/).filter((part) => part !== '')
  return [root.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

/** The folder's full path on the machine; `null` — not known yet (another folder blank, or no name to take). */
export function machineFolder(pick: MachinePick, machine: Pick<WizardMachine, 'root'>, hubName: string): string | null {
  if (pick.other) return pick.path.trim() || null
  const name = pick.folder.trim() || hubName
  return name === '' || machine.root === null ? null : joinOnMachine(machine.root, name)
}

/** Without a remote the project stays on the hub whatever its tick says: unticking it waits for a machine elsewhere. */
export const hubOn = (fields: Pick<WizardFields, 'hubOff'>, remote: string | null): boolean => remote === null || !fields.hubOff

/** The machines elsewhere ticked that can take the project now. */
export function pickedMachines(fields: Pick<WizardFields, 'git' | 'machines'>, machines: WizardMachine[], remote: string | null): WizardMachine[] {
  if (!blockShown(fields, machines)) return []
  return machines.filter((machine) => !machine.own && fields.machines[machine.id]?.on === true && rowState(machine, remote) === 'open')
}

/** What the draft adds of the block: each ticked machine with its folder, and the hub off while unticked. */
export function machinesDraft(fields: Pick<WizardFields, 'git' | 'machines' | 'hubOff'>, machines: WizardMachine[], remote: string | null, hubName: string): Pick<ProjectDraft, 'machines' | 'here'> {
  const picked = pickedMachines(fields, machines, remote)
  if (picked.length === 0) return {}
  const list = picked.map((machine): DraftMachine => {
    const folder = machineFolder(fields.machines[machine.id]!, machine, hubName)
    return folder === null ? { machine: machine.id } : { machine: machine.id, folder }
  })
  return { machines: list, ...(!hubOn(fields, remote) && { here: false }) }
}

/** Why "Add" waits for the block: no machine ticked, or a ticked one's folder blank or taken. */
export type MachinesMissing = 'machines' | 'machineFolder'

export function machinesMissing(
  fields: Pick<WizardFields, 'git' | 'machines' | 'hubOff'>,
  machines: WizardMachine[],
  remote: string | null,
  probes: Record<string, FolderProbe | undefined>,
): MachinesMissing | null {
  if (!blockShown(fields, machines)) return null
  const picked = pickedMachines(fields, machines, remote)
  if (!hubOn(fields, remote) && picked.length === 0) return 'machines'
  const bad = picked.some((machine) => {
    const pick = fields.machines[machine.id]!
    return (pick.other && pick.path.trim() === '') || probes[machine.id]?.state === 'taken'
  })
  return bad ? 'machineFolder' : null
}
