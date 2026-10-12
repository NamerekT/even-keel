/**
 * ASCII frames of a sailboat that rides two trains of waves running at it, rising on the crests, sinking in the troughs and
 * tilting with the slope, under two clouds and a pair of gulls. The picture is as wide as it is asked to be: the sea and
 * the sky stretch, the boat keeps its size. In `drive` mode the old joke stays: a stiff boat on wheels crawling over a
 * hollow hill, as if over land.
 */

export const VOYAGE_TICK_MS = 90
/** The width in columns the picture is drawn at until the room for it is measured, and the narrowest it gets. */
export const VOYAGE_WIDTH = { start: 100, min: 64 }

const SEA = 24
const CHOP = '~-~~-~'
/** Marks under the surface: how many cells in a hundred hold one just under the calm level, and how many fewer each row down. */
const DEEP = { near: 16, fade: 2 }
const HEIGHT = SEA + 6
/** Rows the clouds and the gulls keep to; below them the sky stays as the sea and the boat leave it. */
export const SKY_ROWS = 7
/** Wave trains summed into the sea: length in columns, crest height in rows, columns per tick. They run to the left. */
const WAVES = [
  { length: 64, height: 2.4, speed: 0.6 },
  { length: 29, height: 0.7, speed: 0.42 },
]
/** How much sharper a crest is than a trough; past 0.25 the trough grows a bump of its own. */
const SHARP = 0.15
/** A short ripple over the waves, running the other way: height in rows, length in columns, columns per tick. */
const RIPPLE = { height: 0.12, length: 7, speed: 0.25 }
/** Where in its row each character's mark sits, as a share of the row from its top: the water's height inside a row. */
const WATER: [number, string][] = [
  [0.15, "'"],
  [0.5, '-'],
  [0.78, '.'],
  [0.97, '_'],
]
/** The drive's hill: height in rows and half width in columns. */
const HILL = { height: 6, half: 30 }
/** Columns the hill moves per tick. */
const HILL_SPEED = 0.6
const CALM_TICKS = 40
/** How much taller a character cell is than it is wide (7px mono, line-height 1.1). */
const ASPECT = 1.8
/** Lines flatter than this are drawn with `_` and `-`, steeper than `UPRIGHT` with `|`, in between with `/` and `\`. */
const FLAT = (25 * Math.PI) / 180
const UPRIGHT = (75 * Math.PI) / 180
const SWAY = { angle: 0.05, ticks: 28 }
/** The boat's tilt, bow up, from which the bow throws spray. */
const SPRAY_TILT = 0.05
/** Spray drops as row and column offsets from the bow's deck corner, two sets that take turns. */
const SPRAY = [
  [[-1, 1, "'"], [-2, 2, '.'], [0, 2, ','], [-3, 1, '.'], [-1, 3, '.'], [-4, 3, "'"]],
  [[-2, 1, '.'], [-1, 2, "'"], [-3, 3, "'"], [0, 1, ','], [-4, 2, '.'], [-2, 4, '.']],
] as const
const WAKE = ['=-~-. ~ .  .', '-=~.- . ~  .']

/** The hull, level whatever the sea does: the deck, portholes, a stripe and the bottom. `#` is a blank the sea and the sky do not show through. */
const HULL = [
  '_________________|_________________',
  '\\###o####o####o####o####o####o####/',
  ' \\===============================/',
  '  \\_____________________________/',
]
/** Rows of the rig over the hull; the deck is the row after them. */
const RIG_ROWS = 13
const BOAT_ROWS = RIG_ROWS + HULL.length
/** The mast's column in the sprite, under which the sea lifts the boat. */
const MAST = 17
/** What the driving boat rolls on, under its hull. */
const WHEELS = '       (o)              (o)'
/** The masthead pennant, two frames that take turns. */
const PENNANT = ['~>', '->']
const PENNANT_TICKS = 3

/** A point in the sprite: column and row edges, rows counted down. */
type Point = readonly [number, number]
/** The rig leans from the mast's foot. A hull cannot tilt in ASCII: past ~5° it breaks into steps, so it stays level. */
const FOOT: Point = [MAST + 0.5, RIG_ROWS + 1]
const RIG_SOLIDS: Point[][] = [
  [[MAST + 0.5, 1], [30, 13], [MAST + 0.5, 13]],
  [[MAST + 0.5, 5], [MAST + 0.5, 13], [11, 13]],
]
const RIG_LINES: [Point, Point][] = [
  [[12, 13], [29, 13]],
  [[18, 1], [30, 13]],
  [[17, 5], [11, 13]],
  [[MAST + 0.5, 0], [MAST + 0.5, RIG_ROWS + 1]],
]
/** The middle of the mast's top cell, the pennant flying right of it. */
const MAST_HEAD: Point = [MAST + 0.5, 0.5]
/** The hull's bottom row from its stern corner to its bow corner, which the chop covers wherever the water reaches it. */
const KEEL = { row: BOAT_ROWS - 1, from: 2, to: 32 }
const BOW_DECK: Point = [HULL[0]!.length, RIG_ROWS + 1]
/** How far bow and stern reach from the mast, where the waves under them tilt the boat. */
const REACH = 14
/** The share of the waves' slope the rig leans by: they never stop, so a full lean would keep the sails broken half the time. */
const LEAN = 0.3
/** Past this the mast's lean reads as a fall. */
const MAX_LEAN = 0.16

const CLOUDS = [
  { lines: ['   .--.', '.-(    ).', '(___.__)__)'], top: 0, ticks: 5, from: 0 },
  { lines: [' .-.', '(___)'], top: 3, ticks: 3, from: 45 },
]
/** Gulls: the row they glide at, the column they start from and ticks per column; they fly with the boat. */
const GULLS = [
  { row: 4, from: 8, ticks: 6 },
  { row: 2, from: 22, ticks: 8 },
]
const FLAP = ['\\v/', '-v-']
const FLAP_TICKS = 4

/** The column under the boat's mast in a picture `width` columns wide. */
export function mastAt(width = VOYAGE_WIDTH.start): number {
  return boatLeft(width) + MAST
}

/** The boat stands a bit left of the middle, with room ahead for the waves it meets. */
function boatLeft(width: number): number {
  return Math.round(width * 0.4) - MAST
}

/** How far the sea stands over its calm level `column` columns in at the tick, in rows, below it negative. */
export function seaAt(column: number, tick: number): number {
  return WAVES.reduce((sum, { length, height, speed }) => {
    const phase = (2 * Math.PI * (column + tick * speed)) / length
    return sum + (height * (Math.cos(phase) + SHARP * Math.cos(2 * phase))) / (1 + SHARP)
  }, 0)
}

/** How high the sea lifts the sailing boat, in rows, below the calm level negative, and how far it tilts it, in radians, bow up positive. */
export function poseAt(tick: number, width = VOYAGE_WIDTH.start): { lift: number; tilt: number } {
  const mast = mastAt(width)
  const bow = seaAt(mast + REACH, tick)
  const stern = seaAt(mast - REACH, tick)
  const lift = (bow + 2 * seaAt(mast, tick) + stern) / 4
  return { lift, tilt: LEAN * Math.atan2((bow - stern) * ASPECT, 2 * REACH) }
}

/** The drive's hill rise in rows `offset` columns from its top. */
function rise(offset: number): number {
  const { height, half } = HILL
  return Math.abs(offset) >= half ? 0 : (height * (1 + Math.cos((Math.PI * offset) / half))) / 2
}

function slope(offset: number): number {
  const { height, half } = HILL
  if (Math.abs(offset) >= half) return 0
  return ((-height * Math.PI) / (2 * half)) * Math.sin((Math.PI * offset) / half)
}

/** Where the drive's hill top is at the tick; far off the left edge during the calm. */
export function crestAt(tick: number, width = VOYAGE_WIDTH.start): number {
  const { half } = HILL
  const crossing = (width + 2 * half) / HILL_SPEED
  const step = wrap(tick, crossing + CALM_TICKS)
  return width + half - Math.min(step, crossing) * HILL_SPEED
}

/** The frame at `tick`, with the sky at its own tick. Ticks before zero are fine, so the voyage can run backwards. */
export function voyageFrame(tick: number, drive = false, sky = tick, width = VOYAGE_WIDTH.start): string {
  const canvas = new Canvas(HEIGHT, Math.max(VOYAGE_WIDTH.min, width))
  drawSky(canvas, sky)
  if (drive) driveFrame(canvas, tick)
  else sailFrame(canvas, tick)
  return canvas.lines().join('\n')
}

/** `value` modulo `size`, never negative. */
function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}

/** The boat alone with its rig leaning by `angle`, trimmed to its drawing. */
export function boatSketch(angle: number): string[] {
  const canvas = new Canvas(BOAT_ROWS + 4, 60)
  drawBoat(canvas, 2, 10, angle, 0)
  const lines = canvas.lines().map((line) => line.trimEnd())
  const used = lines.slice(lines.findIndex((line) => line !== ''), lines.findLastIndex((line) => line !== '') + 1)
  const indent = Math.min(...used.filter((line) => line !== '').map((line) => line.length - line.trimStart().length))
  return used.map((line) => line.slice(indent))
}

class Canvas {
  private readonly grid: string[][]
  readonly width: number
  /** Rows from this one down are not drawn on. */
  floor = Infinity

  constructor(height: number, width: number) {
    this.width = width
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

  /** Writes a sprite line from `column` on. */
  text(row: number, column: number, line: string): void {
    ;[...line].forEach((char, index) => this.put(row, column + index, char))
  }

  lines(): string[] {
    return this.grid.map((row) => row.join(''))
  }
}

function drawSky(canvas: Canvas, tick: number): void {
  for (const { lines, top, ticks, from } of CLOUDS) {
    const span = Math.max(...lines.map((line) => line.length))
    const left = canvas.width - wrap(Math.floor(tick / ticks) + from, canvas.width + span)
    lines.forEach((line, row) => canvas.text(top + row, left, line))
  }
  GULLS.forEach(({ row, from, ticks }, index) => {
    const left = wrap(from + Math.floor(tick / ticks), canvas.width + 6) - 3
    const bob = Math.round(Math.sin(tick / 23 + index * 2))
    canvas.text(row + bob, left, FLAP[wrap(Math.floor(tick / FLAP_TICKS) + index, FLAP.length)]!)
  })
}

/** Scattered marks drifting under the water, slower the deeper they are; a fixed pattern of lines would line up into columns. */
function deepChar(row: number, column: number, tick: number): string {
  const depth = Math.max(0, row - SEA)
  const cell = noise(row, column + Math.floor(tick / (depth + 2)))
  return cell * 100 < DEEP.near - DEEP.fade * depth ? (cell * 100 < 4 ? '.' : '~') : ' '
}

/** A number in [0, 1) that looks random but is the same for the same cell. */
function noise(row: number, column: number): number {
  const value = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** The character whose mark sits nearest to `share` of a row from its top. */
function waterChar(share: number): string {
  return WATER.reduce((best, mark) => (Math.abs(mark[0] - share) < Math.abs(best[0] - share) ? mark : best))[1]
}

function sailFrame(canvas: Canvas, tick: number): void {
  // Rows counted down, with the fraction inside the row; the calm sea runs through the middle of row `SEA`.
  const surface = Array.from({ length: canvas.width }, (_, column) => {
    const x = column + 0.5
    const ripple = RIPPLE.height * Math.sin((2 * Math.PI * (x - tick * RIPPLE.speed)) / RIPPLE.length)
    return SEA + 0.5 - seaAt(x, tick) - ripple
  })
  const rows = surface.map(Math.floor)
  surface.forEach((level, column) => {
    const top = rows[column]!
    canvas.set(top, column, waterChar(level - top))
    for (let row = top + 1; row < HEIGHT; row++) canvas.set(row, column, deepChar(row, column, tick))
  })

  // The lift is whole rows, so the hull keeps its shape.
  const left = boatLeft(canvas.width)
  const pose = poseAt(tick, canvas.width)
  const angle = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, pose.tilt + SWAY.angle * Math.sin((2 * Math.PI * tick) / SWAY.ticks)))
  const top = SEA - (BOAT_ROWS - 1) - Math.round(pose.lift)
  drawBoat(canvas, top, left, angle, tick)

  const keel = top + KEEL.row
  for (let column = left + KEEL.from; column <= left + KEEL.to; column++) {
    if (surface[column]! < keel + 0.5) canvas.set(keel, column, CHOP[wrap(column + tick, CHOP.length)]!)
  }
  ;[...WAKE[wrap(tick, 2)]!].forEach((char, index) => {
    const column = left + KEEL.from - 1 - index
    if (column >= 0 && rows[column]! >= keel) canvas.put(rows[column]!, column, char)
  })

  if (pose.tilt >= SPRAY_TILT) drawSpray(canvas, top, left, tick)
}

function drawSpray(canvas: Canvas, top: number, left: number, tick: number): void {
  const bow = left + BOW_DECK[0] - 1
  for (const [down, right, char] of SPRAY[wrap(tick, 2)]!) canvas.put(top + BOW_DECK[1] - 1 + down, bow + right, char)
}

/** Draws the level hull with the rig's top row at `top` and the rig over it leaning by `angle`, bow up positive. */
function drawBoat(canvas: Canvas, top: number, left: number, angle: number, tick: number): void {
  HULL.forEach((line, row) => canvas.text(top + RIG_ROWS + row, left, line))
  // Sheared, not turned: the boom keeps its row, so it never breaks into steps or sinks into the deck.
  const shift = Math.tan(angle) * ASPECT
  const toScreen = ([column, row]: Point): Point => [left + column - (FOOT[1] - row) * shift, top + row]
  canvas.floor = top + RIG_ROWS
  for (const solid of RIG_SOLIDS) fill(canvas, solid.map(toScreen))
  for (const [from, to] of RIG_LINES) stroke(canvas, toScreen(from), toScreen(to))
  const [mast] = toScreen(MAST_HEAD)
  canvas.text(top, Math.floor(mast) + 1, PENNANT[wrap(Math.floor(tick / PENNANT_TICKS), PENNANT.length)]!)
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

function driveFrame(canvas: Canvas, tick: number): void {
  const crest = crestAt(tick, canvas.width)
  const levels = Array.from({ length: canvas.width }, (_, column) => Math.round(rise(column - crest)))
  levels.forEach((level, column) => {
    const before = levels[column - 1] ?? 0
    for (let step = before + 1; step <= level; step++) canvas.put(SEA - step + 1, column, '/')
    for (let step = level + 1; step <= before; step++) canvas.put(SEA - step + 1, column, '\\')
    if (level === before) canvas.put(SEA - level, column, level === 0 ? CHOP[wrap(column + tick, CHOP.length)]! : '_')
    for (let row = SEA + 1; row < HEIGHT; row++) canvas.put(row, column, deepChar(row, column, tick))
  })

  const left = boatLeft(canvas.width)
  const lift = Math.round(rise(mastAt(canvas.width) - crest))
  const top = SEA - BOAT_ROWS - lift
  drawBoat(canvas, top, left, 0, tick)
  canvas.text(top + BOAT_ROWS, left, WHEELS)
  if (slope(mastAt(canvas.width) - crest) >= 0.2) drawSpray(canvas, top, left, tick)
}
