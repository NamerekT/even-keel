import { notice, type Notice } from '../notice/notice.js'

/** The machine a launch block came from, as the hub knows it. */
export interface BlockedOn {
  id: string
  /** The name the person gave it; empty when the hub has none. */
  name: string
  own: boolean
}

/**
 * A machine's launch block as the hub's chain shows it: only the hub knows the name the person gave the machine. A
 * missing checked copy on a machine elsewhere is not the hub page's to download (BTN-1516): it says whether the machine
 * is downloading it, waits for the hub's consent (`consents`, the hub's `cli.downloaded`) or failed with it.
 */
export function namedBlock(block: Notice | undefined, machine: BlockedOn, consents: readonly string[]): Notice | undefined {
  if (block?.code === 'machines.accountAbsent') return notice('machines.accountAbsent', { ...block.params, machine: machine.id, name: machine.name })
  if (block?.code !== 'agent.copyMissing' || machine.own) return block
  const { title, agent = '', downloading } = block.params
  const state = downloading === true ? 'downloading' : consents.includes(agent) ? 'failed' : 'consent'
  return notice('machines.copyMissing', { title, agent, machine: machine.id, name: machine.name, state })
}
