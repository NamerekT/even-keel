import { useNavigate, useSearchParams } from 'react-router'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { PassableStep } from '../../../src/setup.js'
import type { EvenKeelState } from '../../../src/state.js'
import { readinessOf } from '../accounts.js'
import { accountName } from '../accountName.js'
import { language, say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ownProjects } from '../state.js'
import { Segmented } from '../stats/common.js'
import { Card } from '../ui/blocks.js'
import { Row } from './settingsParts.js'
import { providerName } from './settingsRun.js'
import { AgentStep } from './SetupAgent.js'
import { Cards, type Save } from './SetupChoices.js'
import { GitStep } from './SetupGit.js'
import { ADD_PROJECT, FROM_SETUP, setupFacts } from './SetupAsk.js'
import { accountShortName, gitStepReady, gitYesToKeep, OPTIONAL_STEPS, profileShortName, SETUP_STEPS, setupStep, stepAnswered, stepBeside, stepPath, type SetupStep } from './setupSteps.js'
import { trackerProfiles, TrackerStep } from './SetupTracker.js'
import { StatsStep } from './StatsSetup.js'
import { WizardFoot, WizardFrame, type StepSummary, type WizardStep } from './WizardFrame.js'
import { AgentIcon } from '../layout/accountParts.js'
import { TrackerIcon } from '../ui/icons.js'
import '../stats/stats.css'
import './accounts.css'
import './settings.css'
import './projectAdd.css'
import './tally.css'
import './setup.css'

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
  const own = ownProjects(state).length
  const done = () => void navigate(own === 0 ? ADD_PROJECT : '/', { replace: true, state: FROM_SETUP })
  // A step gone past with no setting of its own is kept, so it is not offered again (BTN-1023).
  const pass = async (passable: PassableStep) => shared.setupPassed.includes(passable) || (await save({ setupPassed: [...shared.setupPassed, passable] }))

  // The page's language shown is only a guess until it is written: "Next" keeps it.
  // `picked`: a card on the step has already written its answer, which `shared` of this render does not hold yet.
  const onward = async (picked = false) => {
    if (step === 'language' && shared.language === null && !(await save({ language, promptLanguage: language }))) return
    if (step === 'git' && gitYesToKeep(shared.defaultGit, state.git, picked) && !(await save({ defaultGit: true }))) return
    if (step === 'updates' && !(await pass('updates'))) return
    if (next !== null) void navigate(stepPath(next))
  }
  const skipped = async () => {
    if (!(await pass(step as PassableStep))) return
    if (step === 'stats') done()
    else await onward()
  }

  // Nothing to go on with on the tracker step but a profile: without one, skipping is the way on.
  // The stats step goes on by its cards; skipped, it is asked again once there is a project, so with one it is not skipped.
  const ahead = step === 'tracker' && trackerProfiles(state).length === 0 ? null : next
  const gitHeld = step === 'git' && !gitStepReady(shared.defaultGit, state.git)
  const skippable = OPTIONAL_STEPS.includes(step) && (ahead === null || gitHeld) && !(step === 'stats' && own > 0)
  const skip = !skippable ? undefined : () => void skipped()
  const held = gitHeld || (step === 'agent' && !setupFacts(state).agentReady)
  // The Git and agent steps are parts of their own, each in its card with a dot, as in the project wizard (BTN-603).
  const parts = step === 'agent' || step === 'git'
  const body = <StepBody step={step} state={state} save={save} sending={sending} onDone={done} onPicked={() => void onward(true)} />
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
  const facts = setupFacts(state)
  return [
    ...SETUP_STEPS.map((each) => ({ id: each, label: t.setup.steps[each], summary: summaryOf(each, state), done: stepAnswered(each, facts), to: stepPath(each) })),
    { id: 'project', label: t.setup.steps.project, summary: null, done: false, to: ADD_PROJECT, state: FROM_SETUP },
  ]
}

/**
 * What a step holds, under its dot once it is done (BTN-1380): the prompts' language on a line under the page's, git by
 * its version with its name and e-mail in the tip, the agent and the tracker as their icons before the account's or the
 * profile's name.
 */
export function summaryOf(step: SetupStep, state: EvenKeelState): StepSummary | null {
  const shared = state.config.shared
  if (step === 'language') {
    const page = shared.language ?? language
    const text = t.shared.languages[page]
    return page === shared.promptLanguage ? { text } : { text, note: t.setup.promptsIn(t.shared.languages[shared.promptLanguage]) }
  }
  if (step === 'git') {
    const git = state.git
    if (shared.defaultGit === false) return { text: t.shared.defaultGitOff }
    if (git === undefined || git.version === null) return null
    const who = [git.name, git.email].filter((each): each is string => each !== null)
    return who.length === 0 ? { text: `Git ${git.version}` } : { text: `Git ${git.version}`, tip: who }
  }
  if (step === 'agent') {
    const ready = readinessOf(state.account, shared.provider, shared.accounts[shared.provider] ?? '')
    const agent = providerName(shared.provider)
    const icon = { node: <AgentIcon agent={shared.provider} />, label: agent }
    if (ready.state !== 'signIn' && ready.state !== 'ready') return { text: agent, icon }
    return { text: accountShortName(accountName(ready.entry, state.account.accounts)), icon }
  }
  if (step === 'tracker') {
    const profiles = trackerProfiles(state)
    const first = profiles[0]
    if (first === undefined) return null
    // A profile saved before BTN-1382 may still carry its tracker in front of its name: the summary drops it.
    const title = (kind: string) => state.profiles.kinds.find((each) => each.kind === kind)?.title ?? kind
    const name = (profile: (typeof profiles)[number]) => profileShortName(profile.name, title(profile.kind))
    const summary = { text: name(first), icon: { node: <TrackerIcon kind={first.kind} />, label: title(first.kind) } }
    if (profiles.length === 1) return summary
    return { ...summary, more: profiles.length - 1, tip: profiles.map((profile) => `${name(profile)} (${title(profile.kind)})`) }
  }
  if (step === 'updates') return { text: t.setup.updates[shared.updates.check ? 'on' : 'off'] }
  return state.tally === null ? null : { text: t.tally.modes[state.tally] }
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
  if (step === 'git') return <GitStep state={state} save={save} sending={sending} onPicked={onPicked} />
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
