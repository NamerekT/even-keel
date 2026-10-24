import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CLI_SOURCES, PINNED_PROVIDERS } from '../../../src/agent/providers.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { EvenKeelState, SharedForm } from '../../../src/state.js'
import { CLI_MISSING, cliMissing, PROVIDERS } from '../accounts.js'
import { language, say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { PlusIcon, TrackerIcon } from '../ui/icons.js'
import { AgentReady } from './AgentReady.js'
import { ProfileDialog } from './ProfileDialog.js'
import { FieldHead } from './settingsParts.js'
import { SETUP_STEPS, setupStep, stepBeside, stepPath, type SetupStep } from './setupSteps.js'
import { StatsStep } from './StatsSetup.js'
import { ProfileState } from './TrackerFields.js'
import './accounts.css'
import './settings.css'
import './projectAdd.css'
import './tally.css'
import './setup.css'

const ADD_PROJECT = '/projects/add'

type Save = (change: Partial<SharedForm>) => Promise<boolean>

/**
 * The first run's setup (BTN-310): the languages, the agent and its account, a tracker profile, the update check and
 * the stats, each written at once as the shared settings; the stats end it, and the project wizard comes next.
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

  return (
    <div className="page accounts-page setup">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.setup.title}</h1>
      </header>
      <p className="queue__hint">{t.setup.lead}</p>
      <ol className="add-steps">
        {SETUP_STEPS.map((each) => (
          <li key={each} aria-current={each === step ? 'step' : undefined}>
            {each === step ? t.setup.steps[each] : <Link to={stepPath(each)}>{t.setup.steps[each]}</Link>}
          </li>
        ))}
        <li>{t.setup.steps.project}</li>
      </ol>
      <section className="setup__body">
        <StepBody step={step} state={state} save={save} sending={sending} onDone={done} onPicked={() => void onward()} />
      </section>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      {step !== 'stats' && (
        <div className="account__actions setup__actions">
          {previous !== null && (
            <Link to={stepPath(previous)} className="button">
              ← {t.setup.back}
            </Link>
          )}
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void onward()}>
            {step === 'tracker' && trackerProfiles(state).length === 0 ? t.setup.later : t.setup.next}
          </button>
        </div>
      )}
    </div>
  )
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
    const languages = (chosen: Language, onPick: (value: Language) => void) => (
      <Cards items={LANGUAGES.map((each) => ({ id: each, title: t.shared.languages[each] }))} chosen={chosen} disabled={sending} onPick={onPick} />
    )
    return (
      <>
        <div className="settings__field">
          <FieldHead label={t.setup.pageLanguage} hint={t.setup.pageLanguageHint} />
          {languages(shared.language ?? language, (value) => void save({ language: value, promptLanguage: value }))}
        </div>
        <div className="settings__field">
          <FieldHead label={t.setup.promptLanguage} hint={t.setup.promptLanguageHint} />
          {languages(shared.promptLanguage, (value) => void save({ promptLanguage: value }))}
        </div>
      </>
    )
  }
  if (step === 'agent') return <AgentStep state={state} save={save} sending={sending} />
  if (step === 'tracker') return <TrackerSetup state={state} />
  if (step === 'updates') {
    const pick = async (on: boolean) => {
      if (await save({ updates: { ...shared.updates, check: on } })) onPicked()
    }
    return (
      <>
        <p className="queue__hint">{t.setup.updatesLead}</p>
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

function AgentStep({ state, save, sending }: { state: EvenKeelState; save: Save; sending: boolean }) {
  const shared = state.config.shared
  const provider = shared.provider
  const items = PROVIDERS.map((each) => {
    const missing = cliMissing(state.account, each)
    return {
      id: each,
      title: t.account.agents[each],
      hint: missing ? say({ code: CLI_MISSING[each], params: {} }) : t.account.providerHints[each],
      tag: missing ? t.account.cliNotFound : undefined,
      off: missing,
    }
  })
  return (
    <>
      <p className="queue__hint">{t.setup.agentLead}</p>
      <Cards items={items} chosen={provider} disabled={sending} onPick={(value) => void save({ provider: value })} />
      <div className="settings__field">
        <FieldHead label={t.setup.account} />
        <AgentReady state={state} provider={provider} />
      </div>
      {PINNED_PROVIDERS.includes(provider) && (
        <div className="settings__field">
          <FieldHead label={t.setup.cli} />
          <Cards
            items={CLI_SOURCES.map((each) => ({
              id: each,
              title: t.setup.cliSources[each] ?? each,
              // The download is agreed to here: its size is on the card, not in a tip.
              hint: each === 'checked' && provider === CLAUDE ? `${t.setup.cliHints[each]} ${t.setup.cliSize}` : t.setup.cliHints[each],
            }))}
            chosen={shared.cli[provider] ?? CLI_SOURCES[0]!}
            disabled={sending}
            onPick={(value) => void save({ cli: { ...shared.cli, [provider]: value } })}
          />
        </div>
      )}
    </>
  )
}

const trackerProfiles = (state: EvenKeelState) => {
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  return state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
}

function TrackerSetup({ state }: { state: EvenKeelState }) {
  const [adding, setAdding] = useState(false)
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const profiles = trackerProfiles(state)
  return (
    <>
      <p className="queue__hint">{t.setup.trackerLead}</p>
      {profiles.length === 0 ? (
        <p className="settings__hint">{t.setup.noProfiles}</p>
      ) : (
        <ul className="setup__profiles">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <TrackerIcon kind={profile.kind} />
              <span className="setup__profile-name">{profile.name}</span>
              <ProfileState profile={profile} />
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" className="button" aria-haspopup="dialog" onClick={() => setAdding(true)}>
          <PlusIcon />
          {t.setup.addProfile}
        </button>
      </div>
      {adding && createPortal(<ProfileDialog kinds={kinds} profile={undefined} onClose={() => setAdding(false)} />, document.body)}
    </>
  )
}

interface Card<T extends string> {
  id: T
  title: string
  hint?: string
  tag?: string
  /** Not to be picked: shown dashed, with its tag. */
  off?: boolean
}

/** The account wizard's choice cards as buttons: the value in force pressed, a press writes another one. */
function Cards<T extends string>({ items, chosen, disabled, onPick }: { items: Card<T>[]; chosen: string; disabled: boolean; onPick: (value: T) => void }) {
  return (
    <ul className="add-choices setup__cards">
      {items.map((item) => (
        <li key={item.id}>
          {item.off === true ? (
            <div className="add-choice add-choice--off" aria-disabled="true">
              <CardText item={item} />
            </div>
          ) : (
            <button type="button" className="add-choice" aria-pressed={item.id === chosen} disabled={disabled} onClick={() => onPick(item.id)}>
              <CardText item={item} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function CardText<T extends string>({ item }: { item: Card<T> }): ReactNode {
  return (
    <>
      <span className="add-choice__title">
        {item.title} {item.tag !== undefined && <span className="tag">{item.tag}</span>}
      </span>
      {item.hint !== undefined && <span className="add-choice__hint">{item.hint}</span>}
    </>
  )
}
