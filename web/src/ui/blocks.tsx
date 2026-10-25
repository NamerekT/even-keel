import { useId, useState, type HTMLAttributes, type ReactNode } from 'react'
import './blocks.css'

/** The shared blocks of `docs/design.md`, "Blocks": a page is built of these before it gets classes of its own. */

const join = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

interface PageHeadProps {
  title: ReactNode
  /** The help tip next to the title. */
  help?: ReactNode
  /** Filters and the like, after the title on its line. */
  children?: ReactNode
  /** The page's actions, at the right. */
  actions?: ReactNode
  className?: string
}

/** The title row of a page: the 22 px title, its help, what goes with it, and the actions at the right. */
export function PageHead({ title, help, children, actions, className }: PageHeadProps) {
  return (
    <header className={join('ui-page-head', className)}>
      <h1 className="page__title">{title}</h1>
      {help}
      {children}
      {actions !== undefined && <div className="ui-page-head__actions">{actions}</div>}
    </header>
  )
}

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** The title's id; the card is then labelled by it. */
  titleId?: string
  actions?: ReactNode
  children: ReactNode
}

/** A group of content: a box with its 16 px title and the actions at the right of the title's line. */
export function Card({ title, titleId, actions, className, children, ...rest }: CardProps) {
  return (
    <section className={join('ui-card', className)} aria-labelledby={title === undefined ? undefined : titleId} {...rest}>
      {title !== undefined && <CardHead title={title} id={titleId} actions={actions} />}
      {children}
    </section>
  )
}

interface CardHeadProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  id?: string
  /** A count or a note next to the title. */
  children?: ReactNode
  actions?: ReactNode
}

/** The head of a `Card`, for a card that builds its own (one that folds). */
export function CardHead({ title, id, children, actions, className, ...rest }: CardHeadProps) {
  return (
    <header className={join('ui-card__head', className)} {...rest}>
      <h2 id={id} className="ui-card__title">
        {title}
      </h2>
      {children}
      {actions !== undefined && <div className="ui-card__actions">{actions}</div>}
    </header>
  )
}

/** An 11 px uppercase label that splits one card into parts; never a card's title. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={join('ui-label', className)}>{children}</h3>
}

export function TileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={join('ui-tiles', className)}>{children}</div>
}

/** One number and what it is; `children` go under the note. */
export function Tile({ label, value, note, children }: { label: ReactNode; value: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-tile">
      <span className="ui-tile__label">{label}</span>
      <span className="ui-tile__value">{value}</span>
      {note !== undefined && <span className="ui-tile__note">{note}</span>}
      {children}
    </div>
  )
}

export function FactList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={join('ui-facts', className)}>{children}</dl>
}

/** `warn` and `danger` frame the box in the waiting and error lamps' colours. */
export type FactTone = 'ok' | 'warn' | 'danger'

interface FactProps {
  label: ReactNode
  /** The value: one `<dd>` or more. */
  children: ReactNode
  tone?: FactTone
  /** Across the whole row of facts. */
  wide?: boolean
  className?: string
}

/** A small box with an uppercase label over its value, inside a `FactList`. */
export function Fact({ label, children, tone = 'ok', wide = false, className }: FactProps) {
  return (
    <div className={join('ui-fact', wide && 'ui-fact--wide', tone !== 'ok' && `ui-fact--${tone}`, className)}>
      <dt>{label}</dt>
      {children}
    </div>
  )
}

export type BandTone = 'note' | 'warn' | 'error'

/** A compact warning summary; its action stays reachable while the list is folded. */
export function FoldBand({ title, summary, action, children }: { title: string; summary: string; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="ui-fold-band">
      <Band tone="warn" action={action}>
        <button type="button" className="ui-fold-band__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <strong>{title}</strong>
          <span className="ui-fold-band__summary">{summary}</span>
        </button>
      </Band>
      <div id={id} hidden={!open} className="ui-fold-band__content">{children}</div>
    </div>
  )
}

/** A warning or an error across a card or the page, its action at the right. */
export function Band({ tone, action, children, className }: { tone: BandTone; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={join('ui-band', `ui-band--${tone}`, className)}>
      <div className="ui-band__text">{children}</div>
      {action !== undefined && <div className="ui-band__action">{action}</div>}
    </div>
  )
}

/** What is missing, and the button that adds it. */
export function EmptyState({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={join('ui-empty', className)}>
      <p className="ui-empty__text">{children}</p>
      {action}
    </div>
  )
}
