import type { CSSProperties, ReactNode } from 'react'

interface DividerProps {
  name: string
  count: string
  hidden?: boolean
  /** The delay before the count bumps as a closed task folds into the line. */
  bump?: number
  /** Makes the whole line a button that folds or reveals what the line stands for. */
  toggle?: { expanded: boolean; title: string; run: () => void }
  /** A button of its own after the line, outside the toggle. */
  action?: ReactNode
}

/** The line of a milestone or the archive across the chain: its name, a rule, its count. */
export function Divider({ name, count, hidden = false, bump, toggle, action }: DividerProps) {
  const line = (
    <>
      {toggle !== undefined && (
        <svg className="chain__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M4.5 2.5 8 6l-3.5 3.5" />
        </svg>
      )}
      <span className="chain__milestone-name">{name}</span>
      <span className="chain__milestone-line" aria-hidden="true" />
      <span className="chain__milestone-count">{count}</span>
    </>
  )
  const classes = ['chain__milestone']
  if (hidden) classes.push('chain__milestone--hidden')
  if (bump !== undefined) classes.push('chain__milestone--bump')
  return (
    <h2 className={classes.join(' ')} style={bump === undefined ? undefined : ({ '--beat': `${bump}ms` } as CSSProperties)}>
      {toggle === undefined ? (
        line
      ) : (
        <button type="button" className="chain__toggle" aria-expanded={toggle.expanded} title={toggle.title} onClick={toggle.run}>
          {line}
        </button>
      )}
      {action}
    </h2>
  )
}
