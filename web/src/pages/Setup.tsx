import { useNavigate, useSearchParams } from 'react-router'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { EvenKeelState } from '../../../src/state.js'
import { readinessOf } from '../accounts.js'
import { accountName } from '../accountName.js'
import { language, say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Segmented } from '../stats/common.js'
import { Card } from '../ui/blocks.js'
import { Row } from './settingsParts.js'
import { providerName } from './settingsRun.js'
import { AgentStep } from './SetupAgent.js'
import { Cards, type Save } from './SetupChoices.js'
import { accountShortName, agentReady, OPTIONAL_STEPS, SETUP_STEPS, setupStep, stepBeside, stepPath, type SetupStep } from './setupSteps.js'
import { trackerProfiles, TrackerStep } from './SetupTracker.js'
import { StatsStep } from './StatsSetup.js'
import { listSummary } from './wizard.js'
import { WizardFoot, WizardFrame, type WizardStep } from './WizardFrame.js'
import '../stats/stats.css'
import './accounts.css'
import './settings.css'
import './projectAdd.css'
import './tally.css'
import './setup.css'

const ADD_PROJECT = '/projects/add'

/**
 * The first run's setup (BTN-310, BTN-346): the languages, the agent and its account, a tracker profile, the update
 * check and the stats in the wizard's own frame, each written at once as the shared settings; the stats end it, and the
 * project wizard comes next, the line's last dot.
 */
export function SetupPage({ state }: { state: EvenKeelState }) {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const step = setupStep(search)
  const shared = state.config.shared
  const save: Save = (change) => send('settings', { ...shared, ...change, base: shared } as unknown as Record<string, unknown>)
  const previous = stepBeside(step, -1)
  const next = stepBeside(step, 1)
  const done = () => void navigate(state.projects.length === 0 ? ADD_PROJECT : '/', { replace: true })

  // The page's language shown is only a guess until it is written: "Next" keeps it.
  const onward = async () => {
    if (step === 'language' && shared.language === null && !(await save({ language, promptLanguage: language }))) return
    if (next !== null) void navigate(stepPath(next))
  }

  // Nothing to go on with on the tracker step but a profile: without one, skipping is the way on.
  // The stats step goes on by its cards; skipped, it is asked again once there is a project, so with one it is not skipped.
  const ahead = step === 'tracker' && trackerProfiles(state).length === 0 ? null : next
  const skippable = OPTIONAL_STEPS.includes(step) && ahead === null && !(step === 'stats' && state.projects.length > 0)
  const skip = !skippable ? undefined : step === 'stats' ? done : () => void onward()
  const held = step === 'agent' && !agentReady(shared.provider, state.cliCopies?.[shared.provider], state.account, shared.accounts[shared.provider] ?? '')
  // The agent step is parts of its own, each in its card with a dot, as in the project wizard (BTN-603).
  const parts = step === 'agent'
  const body = <StepBody step={step} state={state} save={save} sending={sending} onDone={done} onPicked={() => void onward()} />
  const foot = (
    <>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <WizardFoot
        back={previous === null ? undefined : { to: stepPath(previous), label: t.setup.back }}
        skip={skip === undefined ? undefined : { label: t.setup.skip, onSkip: skip }}
        next={ahead === null ? undefined : { label: t.setup.nextTo(t.setup.steps[ahead]), onNext: () => void onward(), disabled: sending || held }}
      />
    </>
  )

  return (
    <div className="page setup">
      <WizardFrame title={t.setup.title} lead={t.setup.lead} steps={{ label: t.setup.stepsLabel, list: setupLine(state), current: step }} className={parts ? 'project-add__frame' : undefined}>
        {parts ? (
          <div className="settings__form project-add__steps">
            {body}
            {foot}
          </div>
        ) : (
          <Card title={t.setup.titles[step]} className="setup__card">
            {body}
            {foot}
          </Card>
        )}
      </WizardFrame>
    </div>
  )
}

/** The first run's line of steps; its last dot is the project wizard. */
export function setupLine(state: EvenKeelState): WizardStep[] {
  return [
    ...SETUP_STEPS.map((each) => ({ id: each, label: t.setup.steps[each], summary: summaryOf(each, state), to: stepPath(each) })),
    { id: 'project', label: t.setup.steps.project, summary: null, to: ADD_PROJECT },
  ]
}

/** What a step holds, under its dot once it is done. */
function summaryOf(step: SetupStep, state: EvenKeelState): string | null {
  const shared = state.config.shared
  if (step === 'language') {
    const page = shared.language ?? language
    return page === shared.promptLanguage ? t.shared.languages[page] : `${t.shared.languages[page]} · ${t.shared.languages[shared.promptLanguage]}`
  }
  if (step === 'agent') {
    const ready = readinessOf(state.account, shared.provider, shared.accounts[shared.provider] ?? '')
    const agent = providerName(shared.provider)
    if (ready.state !== 'signIn' && ready.state !== 'ready') return agent
    // An account without a name of its own is called after its agent: once is enough.
    const name = accountShortName(accountName(ready.entry, state.account.accounts))
    return name === agent ? agent : `${agent} · ${name}`
  }
  if (step === 'tracker') return listSummary(trackerProfiles(state).map((profile) => profile.name))
  if (step === 'updates') return t.setup.updates[shared.updates.check ? 'on' : 'off']
  return state.tally === null ? null : t.tally.modes[state.tally]
}

interface BodyProps {
  step: SetupStep
  state: EvenKeelState
  save: Save
  sending: boolean
  onDone: () => void
  /** A choice that is the whole step was made: the setup goes on. */
  onPicked: () => void
}

function StepBody({ step, state, save, sending, onDone, onPicked }: BodyProps) {
  const shared = state.config.shared
  if (step === 'language') {
    const options = LANGUAGES.map((each): [Language, string] => [each, t.shared.languages[each]])
    return (
      <div className="setup__rows">
        <Row
          className="setup__row"
          label={t.setup.pageLanguage}
          hint={t.setup.pageLanguageHint}
          control={
            <Segmented
              label={t.setup.pageLanguage}
              options={options}
              value={shared.language ?? language}
              onChange={(value) => void save({ language: value, promptLanguage: value })}
            />
          }
        />
        <Row
          className="setup__row"
          label={t.setup.promptLanguage}
          hint={t.setup.promptLanguageHint}
          control={<Segmented label={t.setup.promptLanguage} options={options} value={shared.promptLanguage} onChange={(value) => void save({ promptLanguage: value })} />}
        />
      </div>
    )
  }
  if (step === 'agent') return <AgentStep state={state} save={save} sending={sending} />
  if (step === 'tracker') return <TrackerStep state={state} />
  if (step === 'updates') {
    const pick = async (on: boolean) => {
      if (await save({ updates: { ...shared.updates, check: on } })) onPicked()
    }
    return (
      <>
        <p className="setup__lead">{t.setup.updatesLead}</p>
        <Cards
          items={(['on', 'off'] as const).map((each) => ({ id: each, title: t.setup.updates[each], hint: t.setup.updatesHints[each] }))}
          chosen={shared.updates.check ? 'on' : 'off'}
          disabled={sending}
          onPick={(value) => void pick(value === 'on')}
        />
      </>
    )
  }
  return <StatsStep state={state} onDone={onDone} />
}
