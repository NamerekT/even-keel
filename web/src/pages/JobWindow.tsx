import { Fragment, useEffect, useId, useRef } from 'react'
import type { JobStep, StepJob } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useCommand } from '../live/useCommand.js'
import { BangIcon, CheckIcon } from '../ui/icons.js'
import { progressText, stepTime } from './jobProgress.js'
import { RefusalWords } from './RefusalWords.js'
import '../tools/addPackage.css'
import './jobWindow.css'

interface JobWindowProps {
  job: StepJob
  title: string
  /** What the window calls a step of this kind of job. */
  stepLabel: (id: string) => string
  /** The button of a finished job, and what it does: open what the job made. */
  done: { label: string; onDone: () => void }
  /** What Cancel takes back, when not a new project's folder. */
  undoNote?: string
  /** The heading a step falls under, for a job over several projects; `undefined` — none. */
  groupOf?: (id: string) => string | undefined
}

function StepMark({ state }: { state: JobStep['state'] }) {
  if (state === 'done') return <CheckIcon />
  if (state === 'failed') return <BangIcon />
  return <span className={`job-window__dot job-window__dot--${state}`} aria-hidden="true" />
}

function Progress({ step }: { step: JobStep }) {
  const progress = step.progress
  if (progress === undefined) return null
  const known = progress.percent !== undefined
  return (
    <span className="job-window__progress">
      {/* Without a percent the bar only moves; with reduced motion it is not there. */}
      <span className={`job-window__bar${known ? '' : ' job-window__bar--unknown'}`} aria-hidden="true">
        <span className="job-window__fill" style={known ? { width: `${progress.percent}%` } : undefined} />
      </span>
      <span className="job-window__figures">{progressText(progress)}</span>
    </span>
  )
}

function StepState({ step, now }: { step: JobStep; now: Date }) {
  const time = stepTime(step, now)
  return (
    <span className="job-window__state">
      {t.creation.window.states[step.state]}
      {time !== null && <span className="job-window__time"> · {time}</span>}
    </span>
  )
}

/**
 * The window of a job the service does in steps (BTN-1048): each step with its state, a clone's stage, percent, size
 * and speed, the failure with "Retry", and Cancel, which takes back what the job made while it still can. Not tied to
 * the wizard: the job's kind names its steps through `stepLabel`, and adding a machine to a project takes it too.
 */
export function JobWindow({ job, title, stepLabel, done, undoNote, groupOf }: JobWindowProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const { send, sending, failure } = useCommand()
  // The running step's time ticks: a sign of life that needs no motion.
  const now = useNow(1_000)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  // A long job (several projects of a machine) runs below the window's fold: its current step is kept in view.
  const current = job.steps.find((step) => step.state === 'running' || step.state === 'failed')?.id
  const currentRow = useRef<HTMLLIElement>(null)
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const failed = job.failure !== null
  const groupFailures = job.steps.filter((step) => step.failure !== undefined)
  const retry = () => void send('job/retry', { id: job.id })
  // What a kept job made is opened in place of a bare "Close"; Cancel takes back only what can still be.
  const openable = !job.done && !job.undoable && job.result !== undefined
  const stop = job.undoable ? t.creation.window.cancel : t.creation.window.close
  return (
    <dialog
      ref={dialog}
      className="add-package job-window"
      aria-labelledby={heading}
      aria-busy={!job.done && !failed}
      onCancel={(event) => {
        // Esc does not drop a job halfway: the buttons say what happens to it.
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="add-package__frame">
        <header className="add-package__head job-window__head">
          <h2 id={heading} className="add-package__title">
            {title}
          </h2>
          <span className="job-window__subject" title={job.subject}>
            <bdi dir="ltr">{job.subject}</bdi>
          </span>
        </header>
        <div className="add-package__body">
          <ol className="job-window__steps">
            {job.steps.map((step, index) => {
              const group = groupOf?.(step.id)
              const heading = group !== undefined && group !== groupOf?.(job.steps[index - 1]?.id ?? '') ? group : undefined
              return (
                <Fragment key={step.id}>
                  {heading !== undefined && <li className="job-window__group">{heading}</li>}
                  <li ref={step.id === current ? currentRow : undefined} className={`job-window__step job-window__step--${step.state}`}>
                    <StepMark state={step.state} />
                    <span className="job-window__label">{stepLabel(step.id)}</span>
                    <StepState step={step} now={now} />
                    <Progress step={step} />
                  </li>
                </Fragment>
              )
            })}
          </ol>
          {!job.done && <p className="settings__hint job-window__note">{job.undoable ? (undoNote ?? t.creation.window.undoable) : t.creation.window.kept}</p>}
        </div>
        {job.failure !== null && (
          // One line by the failure's code, the tool's words behind a tip: git's ten lines are not why to a person. A fix
          // made in a dialog over the window (git's name and e-mail) retries the failed step by itself. Steps of groups that
          // failed while the job went on (BTN-1297, a machine each) get a line each, named by their group.
          <div role="alert" className="notice notice--error add-package__failure">
            {groupFailures.length === 0 ? (
              <RefusalWords refusal={job.failure} onFixed={retry} />
            ) : (
              groupFailures.map((step) => (
                <p key={step.id} className="job-window__failure">
                  <strong>{groupOf?.(step.id) ?? stepLabel(step.id)}</strong> <RefusalWords refusal={step.failure!} onFixed={retry} />
                </p>
              ))
            )}
          </div>
        )}
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          {!job.done && !openable && (
            <button type="button" className="button" disabled={sending} onClick={() => void send('job/cancel', { id: job.id })}>
              {stop}
            </button>
          )}
          {openable && (
            <button type="button" className="button" disabled={sending} onClick={done.onDone}>
              {done.label}
            </button>
          )}
          {failed && (
            <button type="button" className="button button--primary" disabled={sending} onClick={retry}>
              {t.creation.window.retry}
            </button>
          )}
          {job.done && (
            <button type="button" className="button button--primary" disabled={sending} onClick={done.onDone}>
              {done.label}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}
