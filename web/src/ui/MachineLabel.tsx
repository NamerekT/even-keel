import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { machinePath } from '../machineColor.js'
import type { MachineMarkKind } from '../machineSignIn.js'
import { KeyIcon } from './icons.js'
import { MachineMark, useMachineWords } from './MachineIcon.js'
import { Tipped } from './Tipped.js'
import './machineLabel.css'

/** At most this many labels in a row; the rest are "+N" with their names in its tip. */
export const MACHINE_LABELS_SHOWN = 4

export interface MachineLabelItem {
  id: string
  name: string
  /** Its colour; absent — an older service that sends none: the label stays neutral. */
  color?: string
  /** `token` — only a long token there, a key before the name; `out` — signed out there, a press signs in again. */
  kind?: MachineMarkKind
  tip?: ReactNode
  /** The press of an `out` label: a sign-in on that machine. Without it the label opens the machine's page. */
  onPress?: () => void
  /** A greyed `out` label, its reason in its tip. */
  disabled?: boolean
}

/**
 * A machine as a label (BTN-1309): its icon in its colour and its name in a quiet outline (BTN-1595), as the machine's
 * page heads it, opening that page; its tip says the icon in words. One component for the header's accounts window,
 * the accounts page's "Machines" column and the project's summary.
 */
export function MachineLabel({ id, name, color, kind = 'in', tip, onPress, disabled = false }: MachineLabelItem) {
  const words = useMachineWords()
  const style = color === undefined ? undefined : ({ '--machine': color } as CSSProperties)
  const className = `machine-label machine-label--${kind}`
  const body = <><MachineMark id={id} color={color} />{kind === 'token' && <KeyIcon />}<span className="machine-label__name">{name}</span></>
  const shown = tip === undefined ? words(id) : <><span>{words(id)}</span>{typeof tip === 'string' ? <span>{tip}</span> : tip}</>
  const label = onPress === undefined
    ? <Link to={machinePath(id)} className={className} style={style} onClick={(event) => event.stopPropagation()}>{body}</Link>
    : <button type="button" className={className} style={style} aria-disabled={disabled || undefined}
      onClick={(event) => {
        event.stopPropagation()
        if (!disabled) onPress()
      }}>{body}</button>
  return <Tipped inline className="machine-label__tipped" tip={shown} align="start">{label}</Tipped>
}

/** The machines an account is on: the first `MACHINE_LABELS_SHOWN`, then "+N" naming the rest in its tip. */
export function MachineLabels({ items, className }: { items: MachineLabelItem[]; className?: string }) {
  if (items.length === 0) return null
  const shown = items.slice(0, MACHINE_LABELS_SHOWN)
  const rest = items.slice(MACHINE_LABELS_SHOWN)
  return <span className={className === undefined ? 'machine-labels' : `machine-labels ${className}`}>
    {shown.map((item) => <MachineLabel key={item.id} {...item} />)}
    {rest.length > 0 && <Tipped inline focusable className="machine-labels__more" align="start"
      tip={<>{rest.map((item) => <span key={item.id}>{item.name}</span>)}</>}>
      +{rest.length}
    </Tipped>}
  </span>
}
