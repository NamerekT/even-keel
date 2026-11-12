import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { firstRun } from '../../../src/setup.js'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { ownProjects } from '../state.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { agentReady, setupStop, stepPath, type SetupFacts, type SetupStep } from './setupSteps.js'
import { trackerProfiles } from './SetupTracker.js'

export const ADD_PROJECT = '/projects/add'

/** The router state of a way into the project wizard from the setup itself: the person is walking it, nothing to ask. */
export const FROM_SETUP = { fromSetup: true }

export function setupFacts(state: EvenKeelState): SetupFacts {
  const shared = state.config.shared
  return {
    language: shared.language,
    defaultGit: shared.defaultGit,
    git: state.git,
    agentReady: agentReady(shared.provider, state.cliCopies?.[shared.provider], state.account, shared.accounts[shared.provider] ?? ''),
    profiles: trackerProfiles(state).length,
    tally: state.tally,
    passed: shared.setupPassed,
  }
}

/**
 * The step the setup stopped at while the first run holds (BTN-1023); `null` — nothing to ask: the first run is over, or
 * every step has its answer and the project wizard is the next one.
 */
export function unfinishedStep(state: EvenKeelState): SetupStep | null {
  return firstRun(state.tally, ownProjects(state).length) ? setupStop(setupFacts(state)) : null
}

/**
 * A way into adding a project (BTN-1023): a link to the wizard, or, while the setup is not done, a button that asks
 * first whether to set Even Keel up, and leaves the person where they are on No.
 */
export function AddProjectLink({ state, className, children }: { state: EvenKeelState; className?: string; children: ReactNode }) {
  const [asking, setAsking] = useState(false)
  const step = unfinishedStep(state)
  if (step === null)
    return (
      <Link to={ADD_PROJECT} className={className}>
        {children}
      </Link>
    )
  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
      {asking && <SetupQuestion step={step} onClose={() => setAsking(false)} />}
    </>
  )
}

/** "Set Even Keel up?": Yes goes to the step the setup stopped at, No only closes the question. */
function SetupQuestion({ step, onClose }: { step: SetupStep; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <ConfirmDialog
      title={t.setup.ask.title}
      question={t.setup.ask.question(t.setup.steps[step])}
      confirm={t.setup.ask.yes}
      cancel={t.setup.ask.no}
      busy={false}
      safe
      onConfirm={() => void navigate(stepPath(step))}
      onClose={onClose}
    />
  )
}

/** The project wizard opened by its address while the setup is not done: it asks once, and No leaves the wizard open. */
export function SetupGate({ state }: { state: EvenKeelState }) {
  const location = useLocation()
  const fromSetup = (location.state as typeof FROM_SETUP | null)?.fromSetup === true
  const [step] = useState(() => (fromSetup ? null : unfinishedStep(state)))
  const [open, setOpen] = useState(true)
  if (step === null || !open) return null
  return <SetupQuestion step={step} onClose={() => setOpen(false)} />
}
