import { useLive } from '../live/context.js'
import { inkOn, machineLook, machineWords, type MachineGlyph, type MachineLook } from '../machineIcon.js'
import './machineIcon.css'

/** The signs of the systems, drawn in a 12-unit box: our own drawings, not the brands' logos. */
function Glyph({ glyph, ink }: { glyph: MachineGlyph; ink: string }) {
  if (glyph === 'windows') {
    return <g fill={ink}>
      <rect x="0.4" y="0.4" width="5" height="5" rx="0.9" />
      <rect x="6.6" y="0.4" width="5" height="5" rx="0.9" />
      <rect x="0.4" y="6.6" width="5" height="5" rx="0.9" />
      <rect x="6.6" y="6.6" width="5" height="5" rx="0.9" />
    </g>
  }
  if (glyph === 'linux') {
    return <g fill="none" stroke={ink} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.3 1.9 L5.9 6 L1.3 10.1" />
      <path d="M7.3 10.1 H10.9" />
    </g>
  }
  // ⌘ hollow with its loops outside, so it parts from the solid grid of Windows at 16 px.
  return <path d="M4.2 4.2 V2.6 A1.6 1.6 0 1 0 2.6 4.2 H9.4 A1.6 1.6 0 1 0 7.8 2.6 V9.4 A1.6 1.6 0 1 0 9.4 7.8 H2.6 A1.6 1.6 0 1 0 4.2 9.4 Z"
    fill="none" stroke={ink} strokeWidth="1.5" strokeLinejoin="round" />
}

/**
 * A machine's icon (BTN-1595), filled with its colour: a circle for the hub and a rounded square for a machine, its
 * system's sign inside in an ink that stands out on that colour, and a thin container frame round a smaller shape where
 * Even Keel runs in Docker. Without a colour (an older service) it takes the neutral one. `label` — the icon stands
 * alone and says itself to a screen reader; beside a name it is hidden.
 */
export function MachineIcon({ look, color, size = 20, label = false }: { look: MachineLook; color: string | undefined; size?: number; label?: boolean }) {
  const fill = color ?? 'var(--series-other)'
  const ink = (color === undefined ? undefined : inkOn(color)) ?? 'var(--bg)'
  // The sign fills most of the shape: the circle's inscribed square is smaller than the square's own.
  const place = look.hub ? 'translate(4.4 4.4) scale(0.933)' : 'translate(3.5 3.5) scale(1.083)'
  const body = <>
    {look.hub ? <circle cx="10" cy="10" r="10" fill={fill} /> : <rect width="20" height="20" rx="4.5" fill={fill} />}
    {look.glyph !== null && <g transform={place}><Glyph glyph={look.glyph} ink={ink} /></g>}
  </>
  const a11y = label ? { role: 'img', 'aria-label': machineWords(look) } : { 'aria-hidden': true }
  return (
    <svg className="machine-icon" width={size} height={size} viewBox="0 0 20 20" {...a11y}>
      {look.docker ? <>
        <rect x="0.6" y="0.6" width="18.8" height="18.8" rx="4.6" fill="none" stroke={fill} strokeWidth="1.2" />
        <g transform="translate(2 2) scale(0.8)">{body}</g>
      </> : body}
    </svg>
  )
}

/** A machine's icon by its id: its look and colour from the live state; `color` overrides the colour (a pick being shown). */
export function MachineMark({ id, color, size, label }: { id: string; color?: string | undefined; size?: number; label?: boolean }) {
  const { state } = useLive()
  return <MachineIcon look={machineLook(state, id)} color={color ?? state?.machineColors?.[id]} {...(size !== undefined && { size })} {...(label !== undefined && { label })} />
}

/** A machine's icon in words by its id, for a tip: "Hub, Linux, in Docker". */
export function useMachineWords(): (id: string) => string {
  const { state } = useLive()
  return (id) => machineWords(machineLook(state, id))
}
