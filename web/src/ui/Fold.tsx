import { useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ChevronIcon } from './icons.js'
import './fold.css'

export function FoldCaret() {
  return <span className="ui-fold__caret"><ChevronIcon /></span>
}

export function FoldToggle({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`ui-fold__toggle ${className}`} {...props}><FoldCaret />{children}</button>
}

interface BodyProps {
  open: boolean
  id?: string
  className?: string
  /** A clipped text preview remains visible when folded. */
  preview?: boolean
  onClosed?: () => void
  children: ReactNode | (() => ReactNode)
}

/** Shared height transition, also used by notices and disclosures whose header lives elsewhere. */
export function FoldBody({ open, id, className = '', preview = false, onClosed, children }: BodyProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closed = useRef(onClosed)
  closed.current = onClosed
  const [mounted, setMounted] = useState(open || preview)
  const [expanded, setExpanded] = useState(false)
  if (open && !mounted) setMounted(true)

  useLayoutEffect(() => {
    const node = ref.current!
    // Commit the zero-height grid before opening newly mounted content.
    void node.offsetHeight
    setExpanded(open)
  }, [open])

  useLayoutEffect(() => {
    if (open || expanded || !mounted) return
    const node = ref.current!
    const trigger = id === undefined ? null : document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(id)}"]`)
    let scrollParent = trigger?.parentElement
    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) scrollParent = scrollParent.parentElement
    const boundary = scrollParent?.getBoundingClientRect().top ?? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0)
    const above = trigger !== null && trigger.getBoundingClientRect().top < boundary
    if (node.contains(document.activeElement)) trigger?.focus({ preventScroll: true })
    let cancelled = false
    const finish = () => {
      if (cancelled) return
      if (!preview) setMounted(false)
      if (above) trigger?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      closed.current?.()
    }
    const animations = node.getAnimations()
    if (animations.length === 0) finish()
    else void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish)
    return () => { cancelled = true }
  }, [open, expanded, mounted, id, preview])

  return (
    <div ref={ref} id={id} className={`ui-fold__body${expanded ? ' ui-fold__body--open' : ''}${preview ? ' ui-fold__body--preview' : ''} ${className}`} inert={!open && !preview} aria-hidden={(!open && !preview) || undefined}>
      <div className="ui-fold__clip">{mounted && (typeof children === 'function' ? children() : children)}</div>
    </div>
  )
}

/** Keep a disappearing notice mounted through the shared exit transition. */
export function FoldPresence({ children, className, onClosed }: { children: ReactNode; className?: string; onClosed?: () => void }) {
  const shown = children !== null && children !== undefined && children !== false
  const [last, setLast] = useState(children)
  if (shown && last !== children) setLast(children)
  return <FoldBody open={shown} className={className} onClosed={onClosed}>{shown ? children : last}</FoldBody>
}

interface FoldItem { key: string; children: ReactNode }

/** Removed notices retain their place and content until their individual exit finishes. */
export function FoldList({ items }: { items: FoldItem[] }) {
  const [previous, setPrevious] = useState(items)
  const [rendered, setRendered] = useState(items)
  if (previous !== items) {
    setPrevious(items)
    const next = [...items]
    rendered.forEach((item, index) => {
      if (!items.some(each => each.key === item.key)) next.splice(Math.min(index, next.length), 0, item)
    })
    setRendered(next)
  }
  if (rendered.length === 0) return null
  return <div className="ui-fold-list">{rendered.map(item => {
    const current = items.find(each => each.key === item.key)
    return <FoldPresence key={item.key} onClosed={() => setRendered(rows => rows.filter(each => each.key !== item.key))}>
      {current === undefined ? null : <div className="ui-fold-list__item">{current.children}</div>}
    </FoldPresence>
  })}</div>
}

interface Props extends Omit<BodyProps, 'id' | 'open' | 'preview' | 'onClosed'> {
  open?: boolean
  summary: ReactNode
  summaryClassName?: string
  bodyClassName?: string
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  header?: (toggle: ReactNode) => ReactNode
}

/** An accessible disclosure; controlled state keeps saved and conditional opening policies at the caller. */
export function Fold({ summary, className = '', summaryClassName = '', bodyClassName, open: controlled, defaultOpen = false, onOpenChange, header, children }: Props) {
  const [own, setOwn] = useState(defaultOpen)
  const [previousDefault, setPreviousDefault] = useState(defaultOpen)
  if (previousDefault !== defaultOpen) {
    setPreviousDefault(defaultOpen)
    setOwn(defaultOpen)
  }
  const id = useId()
  const open = controlled ?? own
  const toggle = <FoldToggle className={summaryClassName} aria-expanded={open} aria-controls={id} onClick={() => {
    setOwn(!open)
    onOpenChange?.(!open)
  }}>{summary}</FoldToggle>
  return (
    <div className={`ui-fold ${className}`} data-open={open}>
      {header === undefined ? toggle : header(toggle)}
      <FoldBody id={id} open={open} className={bodyClassName}>{children}</FoldBody>
    </div>
  )
}
