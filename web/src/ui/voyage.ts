/**
 * ASCII frames of a sailboat that rocks on a choppy sea and now and then rides over a low swell, tilting with it.
 * In `drive` mode the old picture stays: a stiff boat on wheels crawling over a hollow hill, as if over land.
 */

const WIDTH = 60
const SEA = 16
const CHOP = '~-~~-~'
const DEEP = ['   ~      ~         ~    .  ', '      .        ~       ~       ']
const HEIGHT = SEA + 1 + DEEP.length
/** A swell's height in rows and its half width in columns. */
interface Swell {
  height: number
  half: number
}
const SAIL_SWELL: Swell = { height: 2, half: 26 }
const DRIVE_SWELL: Swell = { height: 4, half: 18 }
/** Columns the swell moves per tick. */
const SPEED = 0.6
const CALM_TICKS = 40
/** How much taller a character cell is than it is wide (9px mono, line-height 1.1). */
const ASPECT = 1.8
/** Lines flatter than this are drawn with `_` and `-`, steeper than `UPRIGHT` with `|`, in between with `/` and `\`. */
const FLAT = (25 * Math.PI) / 180
const UPRIGHT = (75 * Math.PI) / 180
const SWAY = { angle: 0.06, ticks: 28 }
/** The swell's slope under the boat from which the bow throws spray. */
const SPRAY_SLOPE = 0.08
/** Spray drops as row and column offsets from the bow's deck corner, two sets that take turns. */
const SPRAY = [
  [[-1, 1, "'"], [-2, 2, '.'], [0, 2, ','], [-3, 1, '.']],
  [[-2, 1, '.'], [-1, 2, "'"], [-3, 3, "'"], [0, 1, ',']],
] as const
const WAKE = ['=-~-.', '-=~.-']
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
/** What the driving boat rolls on, under its hull. */
const WHEELS = '    (o)       (o)'
const BOAT_LEFT = 20
const BOAT_MIDDLE = 10
const CLOUD = ['   .--.', '.-(    ).', '(___.__)__)']
const CLOUD_TICKS = 5

/** A point in the sprite above: column and row edges, rows counted down. */
type Point = readonly [number, number]
/** The rig leans around the mast's foot. A two-row hull cannot tilt in ASCII: past ~5° it breaks into steps, so it stays level. */
const FOOT: Point = [10.5, 8]
/** The hull rows of `BOAT`, drawn as they are. */
const HULL_ROWS = 7
const RIG_SOLIDS: Point[][] = [
  [[10.5, 0], [18, 7], [10.5, 7]],
  [[10.5, 3], [10.5, 7], [6, 7]],
]
const RIG_LINES: [Point, Point][] = [
  [[7, 7], [17, 7]],
  [[11, 0], [18, 7]],
  [[10, 3], [6, 7]],
  [[10.5, 0], [10.5, 8]],
]
/** The hull's bottom row from its stern corner to its bow corner, which the chop covers wherever the water reaches it. */
const KEEL = { row: 9, from: 1, to: 19 }
const BOW_DECK: Point = [21, 8]
/** How far bow and stern reach from the mast, where the swell under them tilts the boat. */
const REACH = 9
/** The share of the swell's slope the rig leans by. */
const LEAN = 0.9
/** Past this the sails cross the boom and the deck. */
const MAX_LEAN = 0.16

export const VOYAGE_TICK_MS = 90

/** The swell's rise in rows `offset` columns from its crest. */
function rise(offset: number, { height, half }: Swell = SAIL_SWELL): number {
  return Math.abs(offset) >= half ? 0 : (height * (1 + Math.cos((Math.PI * offset) / half))) / 2
}

function slope(offset: number, { height, half }: Swell): number {
  if (Math.abs(offset) >= half) return 0
  return ((-height * Math.PI) / (2 * half)) * Math.sin((Math.PI * offset) / half)
}

/** Where the swell's crest is at the tick; far off the left edge during the calm. Both swells keep the wider one's pace. */
export function crestAt(tick: number): number {
  const { half } = SAIL_SWELL
  const crossing = (WIDTH + 2 * half) / SPEED
  const step = tick % (crossing + CALM_TICKS)
  return WIDTH + half - Math.min(step, crossing) * SPEED
}

/** The column under the boat's mast, where the swell lifts it. */
export const BOAT_MAST = BOAT_LEFT + BOAT_MIDDLE

/** How high the swell lifts the boat, in rows, and how far it tilts it, in radians, bow up positive. */
export function poseAt(tick: number): { lift: number; tilt: number } {
  const crest = crestAt(tick)
  const bow = rise(BOAT_MAST + REACH - crest)
  const stern = rise(BOAT_MAST - REACH - crest)
  const lift = (bow + rise(BOAT_MAST - crest) + stern) / 3
  return { lift, tilt: lift === 0 ? 0 : LEAN * Math.atan2((bow - stern) * ASPECT, 2 * REACH) }
}

export function voyageFrame(tick: number, drive = false): string {
  return drive ? driveFrame(tick) : sailFrame(tick)
}

/** The boat alone with its rig leaning by `angle`, trimmed to its drawing. */
export function boatSketch(angle: number): string[] {
  const canvas = new Canvas(BOAT.length + 4, WIDTH)
  drawBoat(canvas, 2, angle)
  const lines = canvas.lines().map((line) => line.trimEnd())
  const used = lines.slice(lines.findIndex((line) => line !== ''), lines.findLastIndex((line) => line !== '') + 1)
  const indent = Math.min(...used.filter((line) => line !== '').map((line) => line.length - line.trimStart().length))
  return used.map((line) => line.slice(indent))
}

class Canvas {
  private readonly grid: string[][]
  /** Rows from this one down are not drawn on. */
  floor = Infinity

  constructor(height: number, width: number) {
    this.grid = Array.from({ length: height }, () => Array<string>(width).fill(' '))
  }

  /** Writes the character as is, a blank included. */
  set(row: number, column: number, char: string): void {
    const line = row < this.floor ? this.grid[row] : undefined
    if (line !== undefined && column >= 0 && column < line.length) line[column] = char
  }

  /** Writes a sprite character: a blank is see-through, `#` is an opaque blank. */
  put(row: number, column: number, char: string): void {
    if (char !== ' ') this.set(row, column, char === '#' ? ' ' : char)
  }

  lines(): string[] {
    return this.grid.map((row) => row.join(''))
  }
}

function drawCloud(canvas: Canvas, tick: number): void {
  const left = WIDTH - (Math.floor(tick / CLOUD_TICKS) % (WIDTH + CLOUD[2]!.length))
  CLOUD.forEach((line, row) => [...line].forEach((char, index) => canvas.put(row, left + index, char)))
}

function deepChar(row: number, column: number, tick: number): string {
  const depth = Math.max(0, row - SEA - 1) % DEEP.length
  const line = DEEP[depth]!
  return line[(column + Math.floor(tick / (depth + 2))) % line.length]!
}

function sailFrame(tick: number): string {
  const canvas = new Canvas(HEIGHT, WIDTH)
  drawCloud(canvas, tick)

  const crest = crestAt(tick)
  const surface = Array.from({ length: WIDTH }, (_, column) => Math.round(SEA - rise(column + 0.5 - crest)))
  surface.forEach((top, column) => {
    canvas.set(top, column, CHOP[(column + tick) % CHOP.length]!)
    for (let row = top + 1; row < HEIGHT; row++) canvas.set(row, column, deepChar(row, column, tick))
  })

  // The lift is whole rows, so the hull keeps its shape.
  const pose = poseAt(tick)
  const angle = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, pose.tilt + SWAY.angle * Math.sin((2 * Math.PI * tick) / SWAY.ticks)))
  const top = SEA - (BOAT.length - 1) - Math.round(pose.lift)
  drawBoat(canvas, top, angle)

  const keel = top + KEEL.row
  for (let column = BOAT_LEFT + KEEL.from; column <= BOAT_LEFT + KEEL.to; column++) {
    if (surface[column]! <= keel) canvas.set(keel, column, CHOP[(column + tick) % CHOP.length]!)
  }
  ;[...WAKE[tick % 2]!].forEach((char, index) => {
    const column = BOAT_LEFT - index
    if (column >= 0 && surface[column]! >= keel) canvas.set(surface[column]!, column, char)
  })

  if (slope(BOAT_MAST - crest, SAIL_SWELL) >= SPRAY_SLOPE) {
    const bow = BOAT_LEFT + BOW_DECK[0] - 1
    for (const [down, right, char] of SPRAY[tick % 2]!) canvas.put(top + BOW_DECK[1] - 1 + down, bow + right, char)
  }

  return canvas.lines().join('\n')
}

/** Draws the level hull with its top row at `top` and the rig over it leaning by `angle`, bow up positive. */
function drawBoat(canvas: Canvas, top: number, angle: number): void {
  BOAT.slice(HULL_ROWS).forEach((line, row) => [...line].forEach((char, index) => canvas.put(top + HULL_ROWS + row, BOAT_LEFT + index, char)))
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const toScreen = ([column, row]: Point): Point => {
    const x = column - FOOT[0]
    const y = (FOOT[1] - row) * ASPECT
    return [BOAT_LEFT + FOOT[0] + x * cos - y * sin, top + FOOT[1] - (x * sin + y * cos) / ASPECT]
  }
  canvas.floor = top + HULL_ROWS
  for (const solid of RIG_SOLIDS) fill(canvas, solid.map(toScreen))
  for (const [from, to] of RIG_LINES) stroke(canvas, toScreen(from), toScreen(to))
  canvas.floor = Infinity
}

function fill(canvas: Canvas, polygon: Point[]): void {
  const rows = polygon.map(([, row]) => row)
  const columns = polygon.map(([column]) => column)
  for (let row = Math.floor(Math.min(...rows)); row < Math.max(...rows); row++) {
    for (let column = Math.floor(Math.min(...columns)); column < Math.max(...columns); column++) {
      if (inside(polygon, column + 0.5, row + 0.5)) canvas.set(row, column, ' ')
    }
  }
}

function inside(polygon: Point[], x: number, y: number): boolean {
  let result = false
  polygon.forEach(([x1, y1], index) => {
    const [x2, y2] = polygon[(index + 1) % polygon.length]!
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) result = !result
  })
  return result
}

/** Draws a line through the cells whose centres it crosses, picking characters by its slope on screen. */
function stroke(canvas: Canvas, [x0, y0]: Point, [x1, y1]: Point): void {
  const steep = Math.atan2(Math.abs(y1 - y0) * ASPECT, Math.abs(x1 - x0))
  if (steep < FLAT) {
    const levelAt = (column: number) => Math.round(y0 + ((column + 0.5 - x0) / (x1 - x0)) * (y1 - y0))
    for (let column = Math.ceil(Math.min(x0, x1) - 0.5); column + 0.5 <= Math.max(x0, x1); column++) {
      const level = levelAt(column)
      const next = levelAt(column + 1)
      canvas.put(Math.max(level, next) - 1, column, next < level ? '/' : next > level ? '\\' : '_')
    }
    return
  }
  const top = Math.min(y0, y1)
  const bottom = Math.max(y0, y1)
  const xAt = (y: number) => x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)
  const char = (x1 - x0) * (y1 - y0) < 0 ? '/' : '\\'
  for (let row = Math.ceil(top - 0.5); row + 0.5 <= bottom; row++) {
    const middle = xAt(row + 0.5)
    if (steep > UPRIGHT) {
      canvas.put(row, Math.floor(middle), '|')
      continue
    }
    const count = Math.max(1, Math.floor(Math.abs(xAt(Math.min(row + 1, bottom)) - xAt(Math.max(row, top)))))
    const first = Math.floor(middle - (count - 1) / 2)
    for (let column = first; column < first + count; column++) canvas.put(row, column, char)
  }
}

function driveFrame(tick: number): string {
  const canvas = new Canvas(HEIGHT, WIDTH)
  drawCloud(canvas, tick)

  const crest = crestAt(tick)
  const levels = Array.from({ length: WIDTH }, (_, column) => Math.round(rise(column - crest, DRIVE_SWELL)))
  levels.forEach((level, column) => {
    const before = levels[column - 1] ?? 0
    for (let step = before + 1; step <= level; step++) canvas.put(SEA - step + 1, column, '/')
    for (let step = level + 1; step <= before; step++) canvas.put(SEA - step + 1, column, '\\')
    if (level === before) canvas.put(SEA - level, column, level === 0 ? CHOP[(column + tick) % CHOP.length]! : '_')
    DEEP.forEach((line, depth) => canvas.put(SEA + 1 + depth, column, line[(column + Math.floor(tick / (depth + 2))) % line.length]!))
  })

  const lift = Math.round(rise(BOAT_MAST - crest, DRIVE_SWELL))
  const sprite = [...BOAT, WHEELS]
  sprite.forEach((line, row) => [...line].forEach((char, index) => canvas.put(SEA - (sprite.length - 1 - row) - lift, BOAT_LEFT + index, char)))

  if (slope(BOAT_MAST - crest, DRIVE_SWELL) >= 0.2) {
    const deck = SEA - 3 - lift
    const bow = BOAT_LEFT + BOAT[BOAT.length - 3]!.length - 1
    for (const [row, column, char] of SPRAY[tick % 2]!) canvas.put(deck + row, bow + column, char)
  }

  return canvas.lines().join('\n')
}
