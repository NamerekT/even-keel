/** ASCII frames of a sailboat on a choppy sea that now and then rides over a swell. */

const WIDTH = 60
const SEA = 16
const CHOP = '~-~~-~'
const DEEP = ['   ~      ~         ~    .  ', '      .        ~       ~       ']
const HEIGHT = SEA + 1 + DEEP.length
const SWELL = { height: 4, half: 18 }
/** Columns the swell moves per tick. */
const SPEED = 0.6
const CALM_TICKS = 40
/** The swell's slope under the boat from which the bow throws spray. */
const SPRAY_SLOPE = 0.2
/** Spray drops as row and column offsets from the bow's deck corner, two sets that take turns. */
const SPRAY = [
  [[-1, 1, "'"], [-2, 2, '.'], [0, 2, ','], [-3, 1, '.']],
  [[-2, 1, '.'], [-1, 2, "'"], [-3, 3, "'"], [0, 1, ',']],
] as const
/** `#` is a blank the sea and the sky do not show through. */
const BOAT = [
  '          |\\',
  '          |#\\',
  '          |##\\',
  '         /|###\\',
  '        /#|####\\',
  '       /##|#####\\',
  '      /___|______\\',
  '__________|__________',
  '\\####o####o####o####/',
  ' \\_________________/',
]
const BOAT_LEFT = 20
const BOAT_MIDDLE = 10
const CLOUD = ['   .--.', '.-(    ).', '(___.__)__)']
const CLOUD_TICKS = 5

export const VOYAGE_TICK_MS = 90

/** The swell's rise in rows `offset` columns from its crest. */
export function rise(offset: number): number {
  return Math.abs(offset) >= SWELL.half ? 0 : (SWELL.height * (1 + Math.cos((Math.PI * offset) / SWELL.half))) / 2
}

function slope(offset: number): number {
  if (Math.abs(offset) >= SWELL.half) return 0
  return ((-SWELL.height * Math.PI) / (2 * SWELL.half)) * Math.sin((Math.PI * offset) / SWELL.half)
}

/** Where the swell's crest is at the tick; far off the left edge during the calm. */
export function crestAt(tick: number): number {
  const crossing = (WIDTH + 2 * SWELL.half) / SPEED
  const step = tick % (crossing + CALM_TICKS)
  return WIDTH + SWELL.half - Math.min(step, crossing) * SPEED
}

/** The column under the boat's mast, where the swell lifts it. */
export const BOAT_MAST = BOAT_LEFT + BOAT_MIDDLE

export function voyageFrame(tick: number): string {
  const grid = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill(' '))
  const put = (row: number, column: number, char: string) => {
    if (row >= 0 && row < HEIGHT && column >= 0 && column < WIDTH && char !== ' ') grid[row]![column] = char === '#' ? ' ' : char
  }

  const cloudLeft = WIDTH - (Math.floor(tick / CLOUD_TICKS) % (WIDTH + CLOUD[2]!.length))
  CLOUD.forEach((line, row) => [...line].forEach((char, index) => put(row, cloudLeft + index, char)))

  const crest = crestAt(tick)
  const levels = Array.from({ length: WIDTH }, (_, column) => Math.round(rise(column - crest)))
  levels.forEach((level, column) => {
    const before = levels[column - 1] ?? 0
    for (let step = before + 1; step <= level; step++) put(SEA - step + 1, column, '/')
    for (let step = level + 1; step <= before; step++) put(SEA - step + 1, column, '\\')
    if (level === before) put(SEA - level, column, level === 0 ? CHOP[(column + tick) % CHOP.length]! : '_')
    DEEP.forEach((line, depth) => put(SEA + 1 + depth, column, line[(column + Math.floor(tick / (depth + 2))) % line.length]!))
  })

  const lift = Math.round(rise(BOAT_MAST - crest))
  BOAT.forEach((line, row) => [...line].forEach((char, index) => put(SEA - (BOAT.length - 1 - row) - lift, BOAT_LEFT + index, char)))

  if (slope(BOAT_MAST - crest) >= SPRAY_SLOPE) {
    const deck = SEA - 2 - lift
    const bow = BOAT_LEFT + BOAT[BOAT.length - 3]!.length - 1
    for (const [row, column, char] of SPRAY[tick % 2]!) put(deck + row, bow + column, char)
  }

  return grid.map((row) => row.join('')).join('\n')
}
