import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BangIcon, CheckIcon } from '../ui/icons.js'
import { filledShare, stepMarks, type DotMark } from './wizard.js'
import './wizard.css'

export interface WizardStep {
  id: string
  label: string
  /** What the step holds once done ("English", "GitHub · octo-org"), under its label; `null` — nothing to say. */
  summary: string | null
  to: string
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
  const ids = list.map((step) => step.id)
  const marks = stepMarks(ids, current)
  const style = { '--steps': list.length, '--filled': filledShare(ids, current) } as CSSProperties
  return (
    <nav className="wizard__nav" aria-label={label}>
      <ol className="wizard__steps" style={style}>
        {list.map((step, index) => {
          const mark = marks[index]!
          return (
            <li key={step.id} className={`wizard__step wizard__step--${mark}`}>
              <Link to={step.to} className="wizard__step-link" aria-current={mark === 'current' ? 'step' : undefined}>
                <StepDot mark={mark} />
                <span className="wizard__step-label">{step.label}</span>
                {mark === 'done' && step.summary !== null && <span className="wizard__step-summary">{step.summary}</span>}
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
