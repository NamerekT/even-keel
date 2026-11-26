/**
 * The manifest of the guide's screenshots (`docs/guide/images/shots.json`) and the check that it and the guide agree:
 * every picture a guide page links is a frame, every frame is linked and shot. `docs/web/screenshots.md`, "The guide's frames".
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STEP_KINDS, type Step } from './shot-step.ts'

export const GUIDE = 'docs/guide'
export const IMAGES = `${GUIDE}/images`
export const MANIFEST = `${IMAGES}/shots.json`

export interface Crop { x: number; y: number; width: number; height: number }

export interface Frame {
  id: string
  /** A `dev:fake` route with its query: `/p/ABC?chain=ask`. */
  route: string
  steps: Step[]
  /** The element shot alone; without one, the viewport. */
  selector?: string
  width: number
  height: number
  theme: 'dark' | 'light'
  scale: number
  /** A part of the shot in CSS pixels from the top left of the element or the viewport. */
  crop?: Crop
  /** The WebP quality, above 0 and up to 1. */
  quality: number
  /** Milliseconds after the steps before the shot. */
  settle: number
}

const KEYS = new Set(['id', 'route', 'steps', 'selector', 'width', 'height', 'theme', 'scale', 'crop', 'quality', 'settle'])

const positive = (value: unknown, max: number): value is number => typeof value === 'number' && value > 0 && value <= max

function frameOf(raw: Record<string, unknown>): Frame {
  const where = `frame ${JSON.stringify(raw.id ?? '?')}`
  const fail = (what: string): never => { throw new Error(`${MANIFEST}: ${where}: ${what}`) }
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) fail(`unknown key ${key}`)
  if (typeof raw.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.id)) fail('id is lower-case words joined by -')
  if (typeof raw.route !== 'string' || !/^[?/#]/.test(raw.route)) fail('route starts with ?, / or #')
  if (raw.selector !== undefined && (typeof raw.selector !== 'string' || raw.selector === '')) fail('selector is a non-empty string')
  if (raw.theme !== undefined && raw.theme !== 'dark' && raw.theme !== 'light') fail('theme is dark or light')
  for (const key of ['width', 'height'] as const) if (raw[key] !== undefined && !(Number.isInteger(raw[key]) && positive(raw[key], 4000))) fail(`${key} is a whole number of pixels up to 4000`)
  if (raw.scale !== undefined && !positive(raw.scale, 4)) fail('scale is above 0, up to 4')
  if (raw.quality !== undefined && !positive(raw.quality, 1)) fail('quality is above 0, up to 1')
  if (raw.settle !== undefined && !(Number.isInteger(raw.settle) && (raw.settle as number) >= 0)) fail('settle is a whole number of milliseconds')
  const steps = raw.steps ?? []
  if (!Array.isArray(steps)) fail('steps is a list')
  const parsed = (steps as unknown[]).map((step): Step => {
    const entries = step && typeof step === 'object' ? Object.entries(step) : []
    const [kind, arg] = entries[0] ?? []
    if (entries.length !== 1 || !STEP_KINDS.includes(kind as Step['kind']) || typeof arg !== 'string') {
      fail(`a step is one of ${STEP_KINDS.map((each) => `{"${each}": "…"}`).join(', ')}, got ${JSON.stringify(step)}`)
    }
    return { kind: kind as Step['kind'], arg: arg as string }
  })
  let crop: Crop | undefined
  if (raw.crop !== undefined) {
    const value = raw.crop as Partial<Crop> | null
    const whole = (n: unknown, least: number): boolean => Number.isInteger(n) && (n as number) >= least
    if (!value || !whole(value.x, 0) || !whole(value.y, 0) || !whole(value.width, 1) || !whole(value.height, 1)) fail('crop is {x, y, width, height} in whole pixels')
    crop = { x: value!.x!, y: value!.y!, width: value!.width!, height: value!.height! }
  }
  return {
    id: raw.id as string,
    route: raw.route as string,
    ...(raw.selector !== undefined ? { selector: raw.selector as string } : {}),
    steps: parsed,
    width: (raw.width as number | undefined) ?? 1280,
    height: (raw.height as number | undefined) ?? 800,
    theme: (raw.theme as Frame['theme'] | undefined) ?? 'dark',
    scale: (raw.scale as number | undefined) ?? 1,
    ...(crop ? { crop } : {}),
    quality: (raw.quality as number | undefined) ?? 0.9,
    settle: (raw.settle as number | undefined) ?? 500,
  }
}

export function parseManifest(text: string): Frame[] {
  const raw = JSON.parse(text) as { frames?: unknown }
  if (!Array.isArray(raw.frames)) throw new Error(`${MANIFEST}: no frames list`)
  const frames = raw.frames.map((each) => {
    if (!each || typeof each !== 'object' || Array.isArray(each)) throw new Error(`${MANIFEST}: a frame is an object`)
    return frameOf(each as Record<string, unknown>)
  })
  const seen = new Set<string>()
  for (const frame of frames) {
    if (seen.has(frame.id)) throw new Error(`${MANIFEST}: the frame ${frame.id} is there twice`)
    seen.add(frame.id)
  }
  return frames
}

export const readManifest = (root: string): Frame[] => parseManifest(readFileSync(join(root, MANIFEST), 'utf8'))

/** The file names under `images/` a guide page links, in markdown images and `<img src>`, outside code. */
export function imageRefsOf(text: string): string[] {
  const refs: string[] = []
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) fenced = !fenced
    if (fenced) continue
    const stripped = line.replace(/`[^`]*`/g, '')
    for (const match of stripped.matchAll(/(?:\]\(|src=["'])(?:\.\/)?images\/([^)\s"']+)/g)) refs.push(match[1]!)
  }
  return refs
}

/** What is out of step between the guide's pages, the manifest and `docs/guide/images/`; empty when they agree. */
export function guideImageProblems(root: string): string[] {
  const frames = readManifest(root)
  const ids = new Set(frames.map((frame) => frame.id))
  const linked = new Set<string>()
  const problems: string[] = []
  const pages = readdirSync(join(root, GUIDE)).filter((name) => name.endsWith('.md')).sort()
  for (const page of pages) {
    for (const ref of imageRefsOf(readFileSync(join(root, GUIDE, page), 'utf8'))) {
      const id = ref.endsWith('.webp') ? ref.slice(0, -'.webp'.length) : undefined
      if (id && ids.has(id)) linked.add(id)
      else problems.push(`${GUIDE}/${page} links images/${ref}, which is no frame of ${MANIFEST}`)
    }
  }
  for (const frame of frames) {
    if (!linked.has(frame.id)) problems.push(`the frame ${frame.id} is linked from no page of ${GUIDE}`)
    if (!existsSync(join(root, IMAGES, `${frame.id}.webp`))) problems.push(`the frame ${frame.id} has no ${IMAGES}/${frame.id}.webp: npm run guide-shots -- ${frame.id}`)
  }
  for (const name of readdirSync(join(root, IMAGES)).sort()) {
    if (name === 'shots.json') continue
    if (!(name.endsWith('.webp') && ids.has(name.slice(0, -'.webp'.length)))) problems.push(`${IMAGES}/${name} is no frame of ${MANIFEST}`)
  }
  return problems
}
