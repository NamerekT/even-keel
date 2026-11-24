import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BangIcon, CheckIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { filledShare, stepMarks, type DotMark } from './wizard.js'
import './wizard.css'

/**
 * What a done step holds, under its label (BTN-1380): a fact a line, never glued — the agent's or tracker's icon before a
 * name, the count of the rest in brackets, a second fact as a muted line under it, what does not fit in a tip.
 */
export interface StepSummary {
  text: string
  /** Drawn before the text; `label` names it for a screen reader. */
  icon?: { node: ReactNode; label: string }
  /** The items past the first, shown as "(+2)"; each of them is named in `tip`. */
  more?: number
  /** A second fact on a muted line of its own. */
  note?: string
  /** What the line leaves out, a line each. */
  tip?: string[]
}

export interface WizardStep {
  id: string
  label: string
  /** What the step holds once done; `null` — nothing to say. */
  summary: StepSummary | null
  /** The step has its answer (`stepAnswered`): its dot is checked wherever the user is. */
  done: boolean
  to: string
  /** The router state the step's link carries. */
  state?: unknown
}

interface FrameProps {
  title: string
  lead: string
  /** The name of the steps' line for a screen reader. */
  steps?: { label: string; list: WizardStep[]; current: string }
  className?: string
  children: ReactNode
}

/**
 * A wizard's own frame (BTN-346): one column in the middle of the page with its head, the steps as dots on a line, each
 * a link, and the step itself under them. The first run walks it; the project wizard takes it with the first run's line
 * while there is no project, and without a line once there is one.
 */
export function WizardFrame({ title, lead, steps, className, children }: FrameProps) {
  return (
    <div className={className === undefined ? 'wizard' : `wizard ${className}`}>
      <header className="wizard__head">
        <h1 className="page__title">{title}</h1>
        <p className="wizard__lead">{lead}</p>
      </header>
      {steps !== undefined && <StepLine {...steps} />}
      {/* A new key per step replays the step's entrance. */}
      <div key={steps?.current} className="wizard__body">
        {children}
      </div>
    </div>
  )
}

function StepLine({ label, list, current }: { label: string; list: WizardStep[]; current: string }) {
  const marks = stepMarks(list, current)
  const style = { '--steps': list.length, '--filled': filledShare(list.map((step) => step.id), current) } as CSSProperties
  return (
    <nav className="wizard__nav" aria-label={label}>
      <ol className="wizard__steps" style={style}>
        {list.map((step, index) => {
          const mark = marks[index]!
          return (
            <li key={step.id} className={`wizard__step wizard__step--${mark}`}>
              <Link to={step.to} state={step.state} className="wizard__step-link" aria-current={mark === 'current' ? 'step' : undefined}>
                <StepDot mark={mark} />
                <span className="wizard__step-label">{step.label}</span>
                {mark === 'done' && step.summary !== null && <Summary summary={step.summary} />}
              </Link>
            </li>
          )
        })}
      </ol>
      <p className="wizard__current" aria-hidden="true">
        {list.find((step) => step.id === current)?.label}
      </p>
    </nav>
  )
}

/** A done step's facts under its label (`StepSummary`); a tip, when there is one, opens on pointing. */
export function Summary({ summary }: { summary: StepSummary }) {
  const { text, icon, more, note, tip } = summary
  const lines = (
    <>
      <span className="wizard__step-fact">
        {icon !== undefined && (
          <span className="wizard__step-icon" role="img" aria-label={icon.label}>
            {icon.node}
          </span>
        )}
        <span className="wizard__step-text">{text}</span>
        {more !== undefined && more > 0 && <span className="wizard__step-more">(+{more})</span>}
      </span>
      {note !== undefined && <span className="wizard__step-aside">{note}</span>}
    </>
  )
  if (tip === undefined || tip.length === 0) return <span className="wizard__step-summary">{lines}</span>
  return (
    <Tipped inline className="wizard__step-summary" tip={tip.map((line, index) => <span key={index}>{line}</span>)}>
      {lines}
    </Tipped>
  )
}

/**
 * A step's dot, one look for the line of steps and a step card's head: empty, a ring where the user is, filled with a
 * check once done (the accent on the line, green when a check passed), red when a check refused it. `label` — what it
 * says to a screen reader where no text next to it does.
 */
export function StepDot({ mark, label }: { mark: DotMark; label?: string }) {
  return (
    <span className={`wizard__dot wizard__dot--${mark}`} role={label === undefined ? undefined : 'img'} aria-label={label} aria-hidden={label === undefined || undefined}>
      {(mark === 'done' || mark === 'passed') && <CheckIcon />}
      {mark === 'failed' && <BangIcon />}
    </span>
  )
}

interface FootProps {
  /** The previous step's address; none on the first. */
  back?: { to: string; label: string }
  /** An optional step's way past it. */
  skip?: { label: string; onSkip: () => void }
  /** The main button, named after the step it leads to; Enter presses it too. */
  next?: { label: string; onNext: () => void; disabled?: boolean }
  /** Before the buttons: why the main one is closed, and the like. */
  note?: ReactNode
}

/** The foot of a step: Back as a quiet link at the left, Skip and the main button at the right. */
export function WizardFoot({ back, skip, next, note }: FootProps) {
  const onNext = useRef(next?.onNext)
  onNext.current = next?.disabled === true ? undefined : next?.onNext
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (onNext.current === undefined || !pressesNext(event.target)) return
      event.preventDefault()
      onNext.current()
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [])

  return (
    <div className="wizard__foot">
      {back !== undefined && (
        <Link to={back.to} className="wizard__back">
          ← {back.label}
        </Link>
      )}
      <div className="wizard__onward">
        {note}
        {skip !== undefined && (
          <button type="button" className={next === undefined ? 'button' : 'wizard__skip'} onClick={skip.onSkip}>
            {skip.label}
          </button>
        )}
        {next !== undefined && (
          <button type="button" className="button button--primary" disabled={next.disabled} onClick={next.onNext}>
            {next.label} →
          </button>
        )}
      </div>
    </div>
  )
}

/** Enter goes on only from the page itself: a control, a link or an open dialog keeps its own Enter. */
function pressesNext(target: EventTarget | null): boolean {
  if (document.querySelector('dialog[open]') !== null) return false
  if (!(target instanceof Element)) return true
  return target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="switch"]') === null
}
