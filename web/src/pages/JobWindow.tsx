import { useEffect, useId, useRef } from 'react'
import type { JobStep, StepJob } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { BangIcon, CheckIcon } from '../ui/icons.js'
import { NoticeFixButton } from './FixButtons.js'
import '../tools/addPackage.css'
import './jobWindow.css'

interface JobWindowProps {
  job: StepJob
  title: string
  /** What the window calls a step of this kind of job. */
  stepLabel: (id: string) => string
  /** The button of a finished job, and what it does: open what the job made. */
  done: { label: string; onDone: () => void }
}

function StepMark({ state }: { state: JobStep['state'] }) {
  if (state === 'done') return <CheckIcon />
  if (state === 'failed') return <BangIcon />
  return <span className={`job-window__dot job-window__dot--${state}`} aria-hidden="true" />
}

function Progress({ step }: { step: JobStep }) {
  const progress = step.progress
  if (progress === undefined) return null
  return (
    <span className="job-window__progress">
      <span className="job-window__bar" aria-hidden="true">
        <span className="job-window__fill" style={{ width: `${progress.percent}%` }} />
      </span>
      <span className="job-window__figures">
        {/* The LFS files are a step of their own: its name says the stage. */}
        {progress.stage !== 'lfs' && `${t.creation.window.stages[progress.stage]} · `}
        {progress.percent}%
        {progress.bytes !== undefined && ` · ${t.creation.window.received(progress.bytes, progress.speed)}`}
      </span>
    </span>
  )
}

/**
 * The window of a job the service does in steps (BTN-1048): each step with its state, a clone's stage, percent, size
 * and speed, the failure with "Retry", and Cancel, which takes back what the job made while it still can. Not tied to
 * the wizard: the job's kind names its steps through `stepLabel`, and adding a machine to a project takes it too.
 */
export function JobWindow({ job, title, stepLabel, done }: JobWindowProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const { send, sending, failure } = useCommand()

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const failed = job.failure !== null
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
            {job.steps.map((step) => (
              <li key={step.id} className={`job-window__step job-window__step--${step.state}`}>
                <StepMark state={step.state} />
                <span className="job-window__label">{stepLabel(step.id)}</span>
                <span className="job-window__state">{t.creation.window.states[step.state]}</span>
                <Progress step={step} />
              </li>
            ))}
          </ol>
          {job.failure !== null && (
            <p className="notice notice--error add-package__failure">
              {say(job.failure)} <NoticeFixButton project={null} notice={job.failure} />
            </p>
          )}
          {failure !== null && <p className="notice notice--error add-package__failure">{say(failure)}</p>}
          {!job.done && <p className="settings__hint job-window__note">{job.undoable ? t.creation.window.undoable : t.creation.window.kept}</p>}
        </div>
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
            <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('job/retry', { id: job.id })}>
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
