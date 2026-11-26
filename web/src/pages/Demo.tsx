import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { language, say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { projectPath } from '../state.js'
import { Band, Card } from '../ui/blocks.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { MoreMenu } from '../ui/MoreMenu.js'
import { AddFolderIcon, DemoScreenIcon } from './demoIcons.js'
import { ADD_PROJECT, AddProjectLink, unfinishedStep } from './SetupAsk.js'
import { stepPath } from './setupSteps.js'
import { WizardFrame } from './WizardFrame.js'
import '../tools/addPackage.css'
import './demo.css'

/**
 * Starts the demo (or starts it anew) in the page's language and opens its project once the state names it: the
 * project is new, so it is told apart from the one there was before.
 */
function useDemoStart(state: EvenKeelState) {
  const { send, sending, failure } = useCommand()
  const navigate = useNavigate()
  const [waiting, setWaiting] = useState<{ before: string | null } | null>(null)
  const project = state.demo?.project ?? null

  useEffect(() => {
    if (waiting === null || project === null || project === waiting.before) return
    setWaiting(null)
    void navigate(projectPath(project))
  }, [waiting, project, navigate])

  const start = async (again: boolean) => {
    const before = project
    if (await send(again ? 'demo/again' : 'demo/start', { language })) setWaiting({ before })
  }
  return { start, sending: sending || waiting !== null, failure }
}

/**
 * The home page with no project at all (BTN-776): the demo or the person's own project, each a tile pressed anywhere.
 * While the setup is not done, the project's tile says so and opens the step it stopped at, with no question between.
 */
export function DemoWelcome({ state }: { state: EvenKeelState }) {
  const { start, sending, failure } = useDemoStart(state)
  const step = unfinishedStep(state)
  return (
    <section className="page demo-welcome">
      <WizardFrame title={t.demo.welcome} lead={t.demo.lead}>
        <div className="demo-welcome__choices">
          <button type="button" className="add-package__kind demo-tile" disabled={sending} onClick={() => void start(false)}>
            <span className="add-package__kind-icon">
              <DemoScreenIcon />
            </span>
            <span className="add-package__kind-title">{t.demo.watch}</span>
            <span className="add-package__kind-desc">{t.demo.watchDesc}</span>
          </button>
          <Link to={step === null ? ADD_PROJECT : stepPath(step)} className="add-package__kind demo-tile">
            <span className="add-package__kind-icon">
              <AddFolderIcon />
            </span>
            <span className="add-package__kind-title">{step === null ? t.demo.connectTile : t.demo.setupTile}</span>
            <span className="add-package__kind-desc">{step === null ? t.demo.connectDesc : t.demo.setupDesc}</span>
          </Link>
        </div>
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </WizardFrame>
    </section>
  )
}

/** Removes the demo and goes home: its project page is gone with it. */
function useDemoRemove() {
  const { send, sending, failure } = useCommand()
  const navigate = useNavigate()
  const remove = async () => {
    if (await send('demo/remove')) void navigate('/', { replace: true })
  }
  return { remove, sending, failure }
}

/**
 * What the demo's project page says above its chain (BTN-776): while the scenario runs, a band that it is the demo with
 * the way to one's own project; once it is over, the end card. Nothing for any other project.
 */
export function DemoNotice({ state, project }: { state: EvenKeelState; project: string }) {
  if (state.demo === null || state.demo.project !== project) return null
  return state.demo.finished ? <DemoEnd state={state} /> : <DemoBanner state={state} />
}

function DemoBanner({ state }: { state: EvenKeelState }) {
  const { remove, sending, failure } = useDemoRemove()
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Band
        tone="note"
        className="demo-banner"
        action={
          <>
            <AddProjectLink state={state} className="link-button">
              {t.demo.connect}
            </AddProjectLink>
            <MoreMenu label={t.demo.more} items={[{ label: t.demo.remove, danger: true, pick: () => setAsking(true) }]} />
          </>
        }
      >
        {t.demo.banner}
      </Band>
      {asking && (
        <ConfirmDialog
          title={t.demo.removeTitle}
          question={t.demo.removeQuestion}
          confirm={t.demo.remove}
          cancel={t.demo.removeCancel}
          busy={sending}
          failure={failure === null ? undefined : say(failure)}
          onConfirm={() => void remove()}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  )
}

function DemoEnd({ state }: { state: EvenKeelState }) {
  const { start, sending: starting, failure: startFailure } = useDemoStart(state)
  const { remove, sending: removing, failure: removeFailure } = useDemoRemove()
  const failure = startFailure ?? removeFailure
  // A demo made without git (EKR-115) has no branches to merge: its sessions write in the folder, answers go to the task.
  const plain = state.demo !== null && state.config.projects[state.demo.project]?.git === false
  return (
    <Card title={t.demo.endTitle} className="demo-end">
      <p className="demo-end__text">{plain ? t.demo.endTextPlain : t.demo.endText}</p>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <div className="demo-end__actions">
        <button type="button" className="button" disabled={starting || removing} onClick={() => void remove()}>
          {t.demo.remove}
        </button>
        <button type="button" className="button" disabled={starting || removing} onClick={() => void start(true)}>
          {t.demo.again}
        </button>
        <AddProjectLink state={state} className="button button--primary">
          {t.demo.connect}
        </AddProjectLink>
      </div>
    </Card>
  )
}
