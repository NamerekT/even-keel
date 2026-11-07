import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { firstRun } from '../../../src/setup.js'
import { language, say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ownProjects, projectPath } from '../state.js'
import { Band, Card } from '../ui/blocks.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { MoreMenu } from '../ui/MoreMenu.js'
import { SETUP } from './setupSteps.js'
import { WizardFrame } from './WizardFrame.js'
import './demo.css'

const ADD_PROJECT = '/projects/add'

/** Where "Connect your own" leads: the first run's setup while it is not walked, the project wizard after it. */
export function connectPath(state: EvenKeelState): string {
  return firstRun(state.tally, ownProjects(state).length) ? SETUP : ADD_PROJECT
}

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

/** The home page with no project at all (BTN-776): the demo or the person's own project. */
export function DemoWelcome({ state }: { state: EvenKeelState }) {
  const { start, sending, failure } = useDemoStart(state)
  return (
    <section className="page demo-welcome">
      <WizardFrame title={t.demo.welcome} lead={t.demo.lead}>
        <div className="demo-welcome__choices">
          <Card title={t.demo.watchTitle} className="demo-welcome__choice">
            <p className="demo-welcome__hint">{t.demo.watchHint}</p>
            {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
            <div className="demo-welcome__actions">
              <button type="button" className="button button--primary" disabled={sending} onClick={() => void start(false)}>
                {t.demo.watch}
              </button>
            </div>
          </Card>
          <Card title={t.demo.connectTitle} className="demo-welcome__choice">
            <p className="demo-welcome__hint">{t.demo.connectHint}</p>
            <div className="demo-welcome__actions">
              <Link to={connectPath(state)} className="button">
                {t.demo.connect}
              </Link>
            </div>
          </Card>
        </div>
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
            <Link to={connectPath(state)}>{t.demo.connect}</Link>
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
  return (
    <Card title={t.demo.endTitle} className="demo-end">
      <p className="demo-end__text">{t.demo.endText}</p>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <div className="demo-end__actions">
        <button type="button" className="button" disabled={starting || removing} onClick={() => void remove()}>
          {t.demo.remove}
        </button>
        <button type="button" className="button" disabled={starting || removing} onClick={() => void start(true)}>
          {t.demo.again}
        </button>
        <Link to={connectPath(state)} className="button button--primary">
          {t.demo.connect}
        </Link>
      </div>
    </Card>
  )
}
