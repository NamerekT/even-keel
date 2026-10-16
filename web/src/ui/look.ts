import { isClosedLamp, type BlockLamp, type ChainBlock } from '../state.js'

type SessionLamp = NonNullable<ChainBlock['session']>['lamp']

/** How much room a chain block gets: the current task most, the far end of the chain least. */
export type Tier = 'lead' | 'near' | 'far' | 'past'

export interface Rail {
  family: string
  lane: number
  hue: number
  /** `pass` — a task between two siblings that is not one of them. */
  part: 'start' | 'middle' | 'end' | 'pass'
}

const NEAR = 3
const LANES = 3
export const HUES = 6
const LONGEST_MIN = 240
const SHORTEST_MIN = 5
const REWORK_LABELS = ['переделка', 'rework']

export function tiersOf(blocks: { id: string; lamp: BlockLamp; current: boolean; live: boolean }[]): Map<string, Tier> {
  const tiers = new Map<string, Tier>()
  let ahead = 0
  for (const block of blocks) {
    if (block.current) tiers.set(block.id, 'lead')
    else if (isClosedLamp(block.lamp)) tiers.set(block.id, 'past')
    else tiers.set(block.id, ahead++ < NEAR || block.live ? 'near' : 'far')
  }
  return tiers
}

/** Whether a block shows its session's current action: the lead's until the session finishes, any other only mid-turn, as when the chain is stopped under it. */
export function showsAction(tier: Tier, lamp: SessionLamp | null): boolean {
  if (lamp === null || tier === 'past') return false
  return tier === 'lead' ? lamp !== 'finished' : lamp === 'working'
}

/** The length of the estimate bar: estimates double from step to step, so the bar grows on a log scale. */
export function estimateShare(hours: number | null): number | null {
  if (hours === null || hours <= 0) return null
  const share = Math.log2(1 + (hours * 60) / SHORTEST_MIN) / Math.log2(1 + LONGEST_MIN / SHORTEST_MIN)
  return Math.min(1, share)
}

/** Rails that tie the subtasks of one parent across the chain, one lane per family that overlaps another. */
export function railsOf(blocks: { id: string; parent: string | null }[]): Map<string, Rail[]> {
  const members = new Map<string, number[]>()
  blocks.forEach((block, index) => {
    if (block.parent !== null) members.set(block.parent, [...(members.get(block.parent) ?? []), index])
  })
  const rails = new Map<string, Rail[]>()
  const busyUntil: number[] = []
  for (const [family, indexes] of members) {
    if (indexes.length < 2) continue
    const first = indexes[0]!
    const last = indexes.at(-1)!
    let lane = busyUntil.findIndex((end) => end < first)
    if (lane < 0) lane = busyUntil.length
    if (lane >= LANES) continue
    busyUntil[lane] = last
    const hue = hueOf(family)
    for (let index = first; index <= last; index++) {
      const part: Rail['part'] = index === first ? 'start' : index === last ? 'end' : indexes.includes(index) ? 'middle' : 'pass'
      const id = blocks[index]!.id
      rails.set(id, [...(rails.get(id) ?? []), { family, lane, hue, part }].sort((a, b) => a.lane - b.lane))
    }
  }
  return rails
}

export function isRework(labels: string[]): boolean {
  return labels.some((label) => REWORK_LABELS.includes(label.trim().toLocaleLowerCase()))
}

function hueOf(family: string): number {
  let hash = 0
  for (const char of family) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % HUES
}
