import type { EvenKeelState } from '../../src/state.js'
import { t } from './i18n/index.js'

/** The sign of a machine's system inside its icon (BTN-1595); `null` — a system the page has no sign for. */
export type MachineGlyph = 'windows' | 'macos' | 'linux'

/** The three things a machine's icon tells: hub or machine (its shape), its system (the sign), Docker (the frame). */
export interface MachineLook {
  hub: boolean
  glyph: MachineGlyph | null
  docker: boolean
}

const GLYPHS: Record<string, MachineGlyph> = { win32: 'windows', darwin: 'macos', linux: 'linux' }
const SYSTEMS: Record<MachineGlyph, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }

/** The sign of a `process.platform`. */
export function machineGlyph(platform: string | undefined): MachineGlyph | null {
  return platform === undefined ? null : (GLYPHS[platform] ?? null)
}

/** A machine's look from the state: the hub is the own machine, its system and Docker as it reported them. */
export function machineLook(state: Pick<EvenKeelState, 'ownMachine' | 'machineKinds'> | null | undefined, id: string): MachineLook {
  const kind = state?.machineKinds?.[id]
  return { hub: state?.ownMachine === id, glyph: machineGlyph(kind?.platform), docker: kind?.container === true }
}

/** The icon in words, for its tip: "Hub, Linux, in Docker". */
export function machineWords(look: MachineLook): string {
  const words = t.machines
  return [look.hub ? words.iconHub : words.iconMachine, ...(look.glyph === null ? [] : [SYSTEMS[look.glyph]]), ...(look.docker ? [words.iconDocker] : [])].join(', ')
}

/** The sign's ink on a light colour and on a dark one. */
export const DARK_INK = '#14161a'
export const LIGHT_INK = '#ffffff'

const rgbOf = (hex: string): [number, number, number] | undefined => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  return match === null ? undefined : [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)]
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21; 1 when either is not one. */
export function contrast(one: string, other: string): number {
  const a = rgbOf(one)
  const b = rgbOf(other)
  if (a === undefined || b === undefined) return 1
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/**
 * The ink the sign is drawn in on a machine's colour: whichever of the light and the dark one stands out more, so the
 * sign reads on any colour in either theme, never a cut-out showing the page. `undefined` — not `#rrggbb`.
 */
export function inkOn(color: string): string | undefined {
  if (rgbOf(color) === undefined) return undefined
  return contrast(color, LIGHT_INK) > contrast(color, DARK_INK) ? LIGHT_INK : DARK_INK
}
