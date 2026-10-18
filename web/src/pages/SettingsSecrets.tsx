import { useState, type FormEvent } from 'react'
import type { EvenKeelState, SecretView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Tipped } from '../ui/Tipped.js'
import { HelpTip } from './settingsParts.js'
import { readerLinks, secretGroups, type ReaderLink, type SecretGroup } from './secretsRows.js'
import '../tools/tools.css'
import './secrets.css'

/** The "Access" tab: a row per credential with its own field and button; nothing of it goes into the group drafts. */
export function SettingsSecrets({ state }: { state: EvenKeelState }) {
  const titleOf = (group: SecretGroup) =>
    group.kind === 'tracker' ? t.secrets.tracker(state.trackers.find((each) => each.name === group.tracker)?.title ?? group.tracker) : t.secrets[group.kind]
  return (
    <>
      <p className="settings__hint secrets__hint">{t.secrets.hint}</p>
      {state.secrets.sessionsPending && <p className="notice notice--warn">{t.secrets.pending}</p>}
      {secretGroups(state.secrets.variables).map(({ group, variables }) => (
        <section key={group.kind === 'tracker' ? group.tracker : group.kind} className="secrets__group">
          <h3 className="secrets__title">{titleOf(group)}</h3>
          <ul className="secrets__rows">
            {variables.map((variable) => (
              <SecretRow key={variable.name} variable={variable} state={state} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function SecretRow({ variable, state }: { variable: SecretView; state: EvenKeelState }) {
  const apply = useCommand()
  const drop = useCommand()
  const [value, setValue] = useState('')
  const failure = apply.failure ?? drop.failure
  const busy = apply.sending || drop.sending
  const purpose = t.secrets.purpose[variable.name] ?? variable.name
  const packages = state.packages.keys.find((key) => key.name === variable.name)?.packages ?? []
  const tip = [purpose, packages.length > 0 ? t.secrets.packages(packages.join(', ')) : '', variable.readers.page ? t.secrets.tokenHint : ''].filter((part) => part !== '').join(' ')
  const removable = !variable.outer && !variable.required && (variable.set || variable.sessions === 'other')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await apply.send('secrets/set', { name: variable.name, value })) setValue('')
  }

  return (
    <li className="secrets__row">
      <div className="secrets__head">
        <Tipped className="secrets__name" tip={tip} focusable inline>
          <code>{variable.name}</code>
        </Tipped>
        <span className="secrets__purpose">{purpose}</span>
      </div>
      <div className="secrets__state">
        {variable.outer ? (
          <Tipped tip={t.secrets.outerHint} focusable inline>
            <span className="tools__chip tools__chip--hidden">{t.secrets.outer}</span>
          </Tipped>
        ) : (
          <span className={variable.set ? 'tools__chip tools__chip--on' : 'tools__chip tools__chip--off'}>{variable.set ? t.secrets.set : t.secrets.unset}</span>
        )}
        {variable.required && <span className="tools__chip tools__chip--off">{t.secrets.required}</span>}
        {variable.value !== null && <code className="secrets__value">{variable.value}</code>}
        {variable.set && variable.sessions !== null && variable.sessions !== 'same' && (
          <Tipped tip={t.secrets.sessionsHint} focusable inline>
            <span className="tools__chip tools__chip--lost">{variable.sessions === 'other' ? t.secrets.sessionsOther : t.secrets.sessionsNone}</span>
          </Tipped>
        )}
        {variable.set && readerLinks(variable, state.trackers, state.ci).map((link) => <ReaderChip key={JSON.stringify(link.who)} link={link} />)}
      </div>
      {!variable.outer && (
        <form className="secrets__form" onSubmit={(event) => void submit(event)}>
          <input
            className="settings__text settings__text--mono secrets__input"
            type={variable.secret ? 'password' : 'text'}
            value={value}
            placeholder={variable.value ?? t.secrets.newValue(variable.name)}
            aria-label={t.secrets.newValue(variable.name)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className="button button--small" disabled={busy || value === ''}>
            {t.secrets.apply}
          </button>
          {removable && (
            <button type="button" className="button button--small" disabled={busy} onClick={() => void drop.send('secrets/remove', { name: variable.name })}>
              {t.secrets.remove}
            </button>
          )}
          {variable.places.includes('sessions') && <HelpTip text={`${t.secrets.sessionsHint} ${t.secrets.removeHint}`} />}
        </form>
      )}
      {failure !== null && <p className="notice notice--error secrets__error">{say(failure)}</p>}
    </li>
  )
}

function ReaderChip({ link }: { link: ReaderLink }) {
  const who = 'tracker' in link.who ? link.who.tracker : (t.secrets.ciKinds[link.who.ci] ?? link.who.ci)
  const look = link.state === 'live' ? 'tools__chip--on' : link.state === 'down' ? 'tools__chip--lost' : 'tools__chip--off'
  const chip = <span className={`tools__chip ${look}`}>{t.secrets[link.state](who)}</span>
  if (link.error === null) return chip
  return (
    <Tipped tip={typeof link.error === 'string' ? link.error : say(link.error)} focusable inline>
      {chip}
    </Tipped>
  )
}
