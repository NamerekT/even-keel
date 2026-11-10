import { BADGE_FONTS } from './fonts.generated.js'
import type { BadgeChain, BadgeChipState, BadgeState, BadgeStats, BadgeTask } from './model.js'
import { escapeXml, fit, measure, type BadgeFace } from './text.js'
import { BADGE_THEMES, toolIcon, type BadgeTheme } from './theme.js'

export interface RenderOptions {
  theme: 'dark' | 'light'
  now: Date
  /** The embedded fonts; tests leave them out to keep their snapshots short. */
  fonts?: boolean
}

/**
 * How old the state is and what the chain does: `live` and `stale` (5–60 min, the dot goes grey) are animated, the rest
 * are still. `offline` — no state for an hour; `still` — the service answers, the chain is paused, stopped or idle.
 */
export type BadgeMode = 'live' | 'stale' | 'offline' | 'still' | 'unpublished'

const WIDTH = 840
const PAD = 32
const INNER = WIDTH - PAD * 2
const TOP = 20
const STALE_MIN = 5
const OFFLINE_MIN = 60
const CHIP_HEIGHT = 26
const CHIP_MIN = 86
const CHIP_GAP = 8
const LABEL_SPACING = 1.5
const AGENT_TITLES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', copilot: 'GitHub Copilot' }

export function badgeMode(state: BadgeState | null, now: Date): BadgeMode {
  if (state === null) return 'unpublished'
  const age = ageMinutes(state.at, now)
  if (age > OFFLINE_MIN) return 'offline'
  if (state.chain.state !== 'running') return 'still'
  return age > STALE_MIN ? 'stale' : 'live'
}

/**
 * The badge of a project's chain as an SVG document: no script, no outside resource, animations in its own CSS. The
 * layout follows the mockups of BTN-915: one task gets a large title with its agent under it, several share the rows.
 */
export function renderBadge(state: BadgeState | null, options: RenderOptions): string {
  const theme = BADGE_THEMES[options.theme]
  const mode = badgeMode(state, options.now)
  const draw = new Drawing(theme, mode === 'live' || mode === 'stale')
  const header = headerOf(state, mode, theme, options.now)
  let y = drawHeader(draw, header)
  let height = y + 29
  if (state !== null) {
    if (state.active.length === 0 && mode !== 'still') y = drawLine(draw, nextLine(state.chain), y)
    const single = state.active.length === 1
    state.active.forEach((task, index) => {
      y = drawTask(draw, task, { mode, single, at: state.at, now: options.now }, y + (index > 0 ? 32 : single ? 43 : 41))
    })
    y = drawChain(draw, state, y)
    const footer = drawFooter(draw, state.stats, y)
    height = footer === null ? y + 18 : footer + 14
  }
  height = Math.ceil(height)
  const label = [state === null ? null : projectLabel(state), header.label, ...(state?.active ?? []).map(spoken)].filter((each) => each !== null).join('. ')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
    `<style>${styles(options.fonts !== false)}</style>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="14" fill="${theme.bg}" stroke="${theme.border}"/>`,
    ...draw.parts,
    '</svg>',
  ].join('\n')
}

class Drawing {
  readonly parts: string[] = []
  constructor(
    readonly theme: BadgeTheme,
    readonly animated: boolean,
  ) {}

  text(x: number, y: number, content: string, face: BadgeFace, size: number, fill: string, extra = ''): void {
    const weight = face === 'sans-bold' ? ' font-weight="600"' : ''
    const family = face === 'mono' ? 'm' : 's'
    this.parts.push(`<text x="${n(x)}" y="${n(y)}" class="${family}" font-size="${size}"${weight} fill="${fill}"${extra}>${escapeXml(content)}</text>`)
  }

  add(part: string): void {
    this.parts.push(part)
  }
}

interface Header {
  label: string
  /** The label's colour; the dot's is `dot`. */
  color: string
  dot: string
  /** `ring` — a pulse with a ring; `breathe` — a slow pulse of the dot itself. */
  motion: 'ring' | 'breathe' | null
  subtitle: string | null
  right: string | null
}

function headerOf(state: BadgeState | null, mode: BadgeMode, theme: BadgeTheme, now: Date): Header {
  if (state === null) return { label: 'NOT PUBLISHED YET', color: theme.fgMuted, dot: theme.idle, motion: null, subtitle: null, right: null }
  const name = state.project.name === '' ? state.project.key : state.project.name
  const age = ageMinutes(state.at, now)
  if (mode === 'offline') return { label: `OFFLINE · last seen ${ago(age)}`, color: theme.fgMuted, dot: theme.idle, motion: null, subtitle: name, right: null }
  const right = age < 1 ? 'updated just now' : `updated ${ago(age)}`
  if (mode === 'still') {
    const { chain } = state
    const label = chain.state === 'paused' ? 'CHAIN PAUSED' : chain.state === 'stopped' ? 'CHAIN STOPPED' : chain.next === null ? 'IDLE' : `IDLE · next up: ${chain.next}`
    return { label, color: theme.fgMuted, dot: theme.idle, motion: null, subtitle: name, right }
  }
  const count = state.active.length
  const waiting = count > 0 && state.active.every((task) => task.state !== 'working')
  const stale = mode === 'stale'
  if (waiting) {
    const limited = state.active.filter((task) => task.state === 'limit').length
    const subtitle =
      limited === count ? `${name} waits for the usage limit to reset`
      : limited > 0 ? 'the agents wait for the usage limit and for the maintainer'
      : count === 1 ? 'the agent asked the maintainer and waits for the answer'
      : 'the agents asked the maintainer and wait for the answers'
    return { label: 'WAITING', color: theme.waiting, dot: stale ? theme.idle : theme.waiting, motion: stale ? null : 'breathe', subtitle, right }
  }
  const subtitle = count === 0 ? name : `${name} is being built right now${count > 1 ? ` · ${count} tasks at once` : ''}`
  return { label: 'LIVE', color: theme.done, dot: stale ? theme.idle : theme.done, motion: stale ? null : 'ring', subtitle, right }
}

/** The header's line; returns its baseline. */
function drawHeader(draw: Drawing, header: Header): number {
  const { theme } = draw
  const cy = TOP + 14
  const base = cy + 5
  if (header.motion === 'ring' && draw.animated) draw.add(`<circle cx="${PAD + 8}" cy="${cy}" r="5" fill="${header.dot}" class="ring"/>`)
  draw.add(`<circle cx="${PAD + 8}" cy="${cy}" r="5" fill="${header.dot}"${header.motion === 'breathe' && draw.animated ? ' class="breathe"' : ''}/>`)
  const right = header.right === null ? 0 : measure(header.right, 'sans', 12) + 16
  const labelX = PAD + 24
  const label = fit(header.label, 'sans-bold', 13, WIDTH - PAD - labelX - right - [...header.label].length * LABEL_SPACING)
  draw.text(labelX, base, label, 'sans-bold', 13, header.color, ` letter-spacing="${LABEL_SPACING}"`)
  if (header.subtitle !== null) {
    const x = labelX + measure(label, 'sans-bold', 13) + [...label].length * LABEL_SPACING + 10
    const subtitle = fit(header.subtitle, 'sans', 13, WIDTH - PAD - right - x)
    if (subtitle !== '') draw.text(x, base, subtitle, 'sans', 13, theme.fgMuted)
  }
  if (header.right !== null) draw.text(WIDTH - PAD, base, header.right, 'sans', 12, theme.fgMuted, ' text-anchor="end"')
  return base
}

function drawLine(draw: Drawing, line: string, top: number): number {
  draw.text(PAD, top + 34, fit(line, 'sans', 13, INNER), 'sans', 13, draw.theme.fgMuted)
  return top + 34
}

function nextLine(chain: BadgeChain): string {
  return chain.next === null ? 'no task in hand' : `no task in hand · next up: ${chain.next}`
}

interface TaskLayout {
  mode: BadgeMode
  /** The only task: a large title with the agent under it. */
  single: boolean
  at: string
  now: Date
}

interface Bar {
  top: number
  height: number
  /** The font size of the bar's text. */
  size: number
}

/** A task's title line and its bar, from the title's baseline; returns the bar's bottom. */
function drawTask(draw: Drawing, task: BadgeTask, layout: TaskLayout, base: number): number {
  const { theme } = draw
  const { single } = layout
  const offline = layout.mode === 'offline'
  let x = PAD
  if (offline) {
    draw.text(x, base, 'was working on', 'sans', 13, theme.fgMuted)
    x += measure('was working on', 'sans', 13) + 8
  }
  const keySize = single ? 15 : 14
  draw.text(x, base, task.key, 'mono', keySize, theme.accent)
  x += measure(task.key, 'mono', keySize) + (single ? 16 : 14)
  const meta = metaOf(task, offline ? new Date(layout.at) : layout.now, single)
  const metaWidth = single || meta === '' ? 0 : measure(meta, 'sans', 12) + 16
  const titleSize = single ? 18 : 16
  // No English title — the key alone: a word in its place would read as the task's title (BTN-974).
  if (task.titleEn !== undefined) draw.text(x, base, fit(task.titleEn, 'sans-bold', titleSize, WIDTH - PAD - x - metaWidth), 'sans-bold', titleSize, theme.fg)
  if (meta !== '') {
    if (single) draw.text(x, base + 24, fit(meta, 'sans', 12.5, WIDTH - PAD - x), 'sans', 12.5, theme.fgMuted)
    else draw.text(WIDTH - PAD, base, meta, 'sans', 12, theme.fgMuted, ' text-anchor="end"')
  }
  const bar: Bar = single ? { top: base + 46, height: 30, size: 13 } : { top: base + 22, height: 26, size: 12.5 }
  if (task.state === 'waiting') drawWaiting(draw, task, bar, "waiting for the maintainer's answer")
  else if (task.state === 'limit') drawWaiting(draw, task, bar, limitLine(task, layout.now))
  else drawBar(draw, task, layout.mode, bar)
  return bar.top + bar.height
}

/** The reset is counted when the picture is shown; one that has passed or is not known is not named. */
function limitLine(task: BadgeTask, now: Date): string {
  const minutes = task.until === undefined ? NaN : (Date.parse(task.until) - now.getTime()) / 60_000
  return minutes > 0 ? `waiting for the usage limit · resets in ${duration(minutes)}` : 'waiting for the usage limit'
}

function textBase(bar: Bar): number {
  return bar.top + bar.height / 2 + bar.size * 0.36
}

function drawWaiting(draw: Drawing, task: BadgeTask, bar: Bar, line: string): void {
  const { theme } = draw
  draw.add(
    `<rect x="${PAD + 0.5}" y="${bar.top + 0.5}" width="${INNER - 1}" height="${bar.height - 1}" rx="${bar.height === 30 ? 8 : 7}" fill="${theme.waiting}" fill-opacity="0.08" stroke="${theme.waiting}" stroke-opacity="0.5" stroke-dasharray="5 4"/>`,
  )
  const y = textBase(bar)
  if (task.state === 'limit') draw.add(pauseIcon(PAD + 17.5, bar.top + bar.height / 2, theme.waiting))
  else draw.text(PAD + 14, y, '?', 'sans-bold', bar.size, theme.waiting)
  const label = contextLabel(task)
  draw.text(PAD + 30, y, fit(line, 'mono', bar.size, INNER - 30 - (label === null ? 0 : measure(label, 'mono', 12) + 28) - 14), 'mono', bar.size, theme.warnFg)
  drawContext(draw, task, theme.warnFg, y)
}

function drawBar(draw: Drawing, task: BadgeTask, mode: BadgeMode, bar: Bar): void {
  const { theme } = draw
  const claude = task.agent !== undefined && task.agent.toLowerCase() === 'claude'
  const fill = claude ? theme.claude : theme.working
  const ink = claude ? theme.warnFg : theme.otherFg
  const rx = bar.height === 30 ? 8 : 7
  const { top, height } = bar
  const parts: string[] = [`<rect x="${PAD + 0.5}" y="${top + 0.5}" width="${INNER - 1}" height="${height - 1}" rx="${rx}" fill="${theme.surface}" stroke="${theme.border}"/>`]
  const context = contextOf(task)
  if (context !== null && context > 0) {
    const width = (INNER * context) / 100
    parts.push(`<clipPath id="bar-${n(top)}"><rect x="${PAD}" y="${top}" width="${INNER}" height="${height}" rx="${rx}"/></clipPath>`)
    parts.push(`<rect x="${PAD}" y="${top}" width="${n(width)}" height="${height}" fill="${fill}" fill-opacity="0.22" clip-path="url(#bar-${n(top)})"/>`)
    if (context < 100) parts.push(`<rect x="${n(PAD + width - 1)}" y="${top}" width="2" height="${height}" fill="${ink}"${draw.animated ? ' class="glow"' : ' fill-opacity="0.4"'}/>`)
  }
  const action = task.action ?? null
  parts.push(
    `<g transform="translate(${PAD + 11} ${n(top + (height - 14) / 2)}) scale(0.875)" fill="none" stroke="${theme.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${toolIcon(action?.tool ?? '')}</g>`,
  )
  const label = contextLabel(task)
  const right = label === null ? 0 : measure(label, 'mono', 12) + 28
  const text = action === null ? (task.action === undefined ? '' : 'thinking') : action.text
  const shown = fit(text, 'mono', bar.size, INNER - 30 - right - 14)
  const y = textBase(bar)
  draw.add(mode === 'offline' ? `<g opacity="0.5">${parts.join('')}` : parts.join(''))
  if (shown !== '') draw.text(PAD + 30, y, shown, 'mono', bar.size, ink)
  if (draw.animated) {
    const x = PAD + 30 + measure(shown, 'mono', bar.size) + (shown === '' ? 0 : 4)
    draw.add(`<rect x="${n(x)}" y="${n(top + (height - bar.size - 1) / 2)}" width="${n(bar.size * 0.6)}" height="${bar.size + 1}" fill="${ink}" class="blink"/>`)
  }
  drawContext(draw, task, ink, y)
  if (mode === 'offline') draw.add('</g>')
}

function contextOf(task: BadgeTask): number | null {
  return task.context === undefined ? null : Math.max(0, Math.min(100, Math.round(task.context)))
}

function contextLabel(task: BadgeTask): string | null {
  const context = contextOf(task)
  return context === null ? null : `context ${context}%`
}

function drawContext(draw: Drawing, task: BadgeTask, ink: string, y: number): void {
  const context = contextOf(task)
  if (context === null) return
  draw.add(`<text x="${WIDTH - PAD - 14}" y="${n(y)}" class="m" font-size="12" text-anchor="end"><tspan fill="${draw.theme.fgMuted}">context </tspan><tspan fill="${ink}">${context}%</tspan></text>`)
}

function metaOf(task: BadgeTask, now: Date, single: boolean): string {
  const agent = task.agent === undefined ? null : agentTitle(task.agent)
  const minutes = task.startedAt === undefined ? Infinity : ageMinutes(task.startedAt, now)
  const time = minutes === Infinity ? null : single ? `started ${ago(minutes)}` : duration(minutes)
  return [agent, task.model ?? null, time].filter((each) => each !== null && each !== '').join(' · ')
}

function agentTitle(agent: string): string {
  return AGENT_TITLES[agent.toLowerCase()] ?? `${agent.charAt(0).toUpperCase()}${agent.slice(1)}`
}

/** A chip names a task of the project by its number, like the mockups; one of another project keeps its key. */
function chipLabel(key: string, project: string): string {
  return key.startsWith(`${project}-`) ? key.slice(project.length + 1) : key
}

function chipContent(label: string, state: BadgeChipState): number {
  return (state === 'queued' ? 0 : 14) + measure(label, 'mono', 12)
}

function chipWidth(label: string, state: BadgeChipState): number {
  return Math.max(CHIP_MIN, chipContent(label, state) + 28)
}

/** The chips of the chain and the milestone's summary, from the bottom of what is above; returns the chips' bottom. */
function drawChain(draw: Drawing, state: BadgeState, top: number): number {
  const { theme } = draw
  const { chain } = state
  const milestone = state.milestone ?? null
  if (chain.tasks === undefined && milestone === null) return top
  const y = top + 22
  const base = y + 17
  const summary = milestone === null ? null : `${milestone.name} · ${milestone.done} done · ${milestone.left} to go`
  const summaryShown = summary === null ? null : fit(summary, 'sans', 12.5, INNER / 2)
  const room = INNER - (summaryShown === null ? 0 : measure(summaryShown, 'sans', 12.5) + 16)
  const chips = (chain.tasks ?? []).map((chip) => ({ ...chip, label: chipLabel(chip.key, state.project.key) }))
  let more = 0
  const total = () => chips.reduce((sum, chip) => sum + chipWidth(chip.label, chip.state) + CHIP_GAP, 0) + (more > 0 ? measure(`+${more}`, 'mono', 12) + 8 : 0)
  while (chips.length > 0 && total() > room) {
    const firstDone = chips.findIndex((chip) => chip.state === 'done')
    if (firstDone !== -1 && chips.filter((chip) => chip.state === 'done').length > 1) chips.splice(firstDone, 1)
    else {
      chips.pop()
      more++
    }
  }
  const asked = new Set(state.active.filter((task) => task.state !== 'working').map((task) => task.key))
  let x = PAD
  for (const chip of chips) {
    const width = chipWidth(chip.label, chip.state)
    const look = chipLook(theme, chip.state, asked.has(chip.key))
    draw.add(`<rect x="${n(x + 0.5)}" y="${y + 0.5}" width="${n(width - 1)}" height="${CHIP_HEIGHT - 1}" rx="${CHIP_HEIGHT / 2}" ${look.box}/>`)
    let at = x + (width - chipContent(chip.label, chip.state)) / 2
    if (chip.state !== 'queued') {
      draw.add(chipIcon(chip.state, at + 4, y + CHIP_HEIGHT / 2, look.ink))
      at += 14
    }
    draw.text(at, base, chip.label, 'mono', 12, look.ink)
    x += width + CHIP_GAP
  }
  if (more > 0) draw.text(x, base, `+${more}`, 'mono', 12, theme.fgMuted)
  if (summaryShown !== null) draw.text(WIDTH - PAD, base, summaryShown, 'sans', 12.5, theme.fgMuted, ' text-anchor="end"')
  return y + CHIP_HEIGHT
}

function chipLook(theme: BadgeTheme, state: BadgeChipState, asked: boolean): { box: string; ink: string } {
  const plain = `fill="${theme.surfaceMuted}" stroke="${theme.border}"`
  if (state === 'done') return { box: `fill="${theme.done}" fill-opacity="0.12" stroke="${theme.done}" stroke-opacity="0.45"`, ink: theme.done }
  if (state === 'working') return { box: `fill="${theme.working}" fill-opacity="0.14" stroke="${theme.accent}"`, ink: theme.accent }
  if (state === 'waiting' || state === 'limit') return { box: asked ? `fill="${theme.waiting}" fill-opacity="0.12" stroke="${theme.waiting}"` : plain, ink: theme.waiting }
  return { box: plain, ink: theme.fgMuted }
}

function pauseIcon(cx: number, cy: number, color: string): string {
  return `<path d="M${n(cx - 2.5)} ${n(cy - 4)}v8 M${n(cx + 2.5)} ${n(cy - 4)}v8" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
}

function chipIcon(state: BadgeChipState, cx: number, cy: number, color: string): string {
  if (state === 'done') return `<path d="M${n(cx - 4)} ${cy}l2.7 2.7 5-5.4" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  if (state === 'working') return `<circle cx="${n(cx)}" cy="${cy}" r="3.5" fill="${color}"/>`
  if (state === 'limit') return pauseIcon(cx, cy, color)
  return `<text x="${n(cx)}" y="${cy + 4.5}" class="s" font-size="12" font-weight="600" fill="${color}" text-anchor="middle">?</text>`
}

/** The stats' small print, one line on the right; returns its baseline, `null` — nothing to print. */
function drawFooter(draw: Drawing, stats: BadgeStats | undefined, top: number): number | null {
  if (stats === undefined) return null
  const median = [stats.medianCost === undefined ? null : `${usd(stats.medianCost)}*`, stats.medianMinutes === undefined ? null : duration(stats.medianMinutes)].filter((each) => each !== null)
  const parts = [stats.sessions === undefined ? null : `${grouped(stats.sessions)} ${stats.sessions === 1 ? 'session' : 'sessions'}`, median.length === 0 ? null : `median task ${median.join(' · ')}`].filter(
    (each) => each !== null,
  )
  if (parts.length === 0) return null
  const y = top + 16
  const note = stats.medianCost === undefined ? null : '* at API list prices'
  const room = INNER - (note === null ? 0 : measure(note, 'sans', 11) + 14)
  const line = escapeXml(fit(parts.join(' · '), 'sans', 11, room))
  draw.add(`<text x="${WIDTH - PAD}" y="${y}" class="s" font-size="11" fill="${draw.theme.faint}" text-anchor="end">${line}${note === null ? '' : `<tspan dx="14">${note}</tspan>`}</text>`)
  return y
}

function styles(fonts: boolean): string {
  const faces = fonts
    ? BADGE_FONTS.map((font) => `@font-face{font-family:ek-${font.family};font-weight:${font.weight};src:url(data:font/woff2;base64,${font.woff2}) format('woff2')}`).join('')
    : ''
  return [
    faces,
    '.s{font-family:ek-sans,system-ui,sans-serif}.m{font-family:ek-mono,ui-monospace,monospace}',
    '@keyframes ek-ring{from{transform:scale(1);opacity:.6}to{transform:scale(2.6);opacity:0}}',
    '@keyframes ek-breathe{0%,100%{opacity:1}50%{opacity:.35}}',
    '@keyframes ek-blink{0%,49%{opacity:1}50%,100%{opacity:0}}',
    '@keyframes ek-glow{0%,100%{opacity:.15}50%{opacity:.6}}',
    '.ring{opacity:0;transform-box:fill-box;transform-origin:center;animation:ek-ring 2s ease-out infinite}',
    '.breathe{animation:ek-breathe 4s ease-in-out infinite}',
    '.blink{animation:ek-blink 1.1s step-end infinite}',
    '.glow{animation:ek-glow 3s ease-in-out infinite}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}',
  ].join('')
}

function projectLabel(state: BadgeState): string {
  const { key, name } = state.project
  return name === '' || name === key ? key : `${key} · ${name}`
}

function spoken(task: BadgeTask): string {
  const what = task.state === 'waiting' ? 'waits for an answer' : task.state === 'limit' ? 'waits for the usage limit' : 'in work'
  return `${task.key}${task.titleEn === undefined ? '' : ` ${task.titleEn}`} ${what}`
}

function ageMinutes(at: string, now: Date): number {
  const ms = now.getTime() - Date.parse(at)
  return Number.isNaN(ms) ? Infinity : Math.max(0, ms / 60_000)
}

function ago(minutes: number): string {
  if (minutes === Infinity) return 'long ago'
  if (minutes < 60) return `${Math.floor(minutes)} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`
}

function duration(minutes: number): string {
  if (minutes === Infinity) return ''
  const whole = Math.max(1, Math.round(minutes))
  if (whole < 60) return `${whole} min`
  const rest = whole % 60
  return rest === 0 ? `${whole / 60} h` : `${Math.floor(whole / 60)} h ${rest} min`
}

function usd(value: number): string {
  return value >= 100 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`
}

function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A coordinate without float noise. */
function n(value: number): string {
  return String(Math.round(value * 10) / 10)
}
