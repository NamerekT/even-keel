import { useState, type FormEvent } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import { TALLY_MODES, type TallyMode } from '../../../src/stats/mode.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { FieldHead } from './settingsParts.js'
import './accounts.css'
import './tally.css'

/** The stats setup before the first project (BTN-247). */
export const STATS_SETUP = '/setup/stats'

interface ModesProps {
  /** The card shown pressed: the one picked, or else the one in force. */
  chosen: TallyMode | null
  current: TallyMode | null
  disabled?: boolean
  onPick: (mode: TallyMode) => void
}

/** Where Tally writes, as the account wizard's choice cards; the mode in force is tagged. */
export function TallyModes({ chosen, current, disabled = false, onPick }: ModesProps) {
  return (
    <ul className="add-choices tally-modes">
      {TALLY_MODES.map((mode) => (
        <li key={mode}>
          <button type="button" className="add-choice" aria-pressed={mode === chosen} disabled={disabled} onClick={() => onPick(mode)}>
            <span className="add-choice__title">
              {t.tally.modes[mode]} {mode === current && <span className="tag">{t.tally.current}</span>}
            </span>
            <span className="add-choice__hint">{t.tally.modeHints[mode]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Settings → Stats: the mode in force pressed; another one applies with a button, the user's own Postgres through its fields. */
export function TallySettings({ state }: { state: EvenKeelState }) {
  const { send, sending, failure } = useCommand()
  const [picked, setPicked] = useState<TallyMode | null>(null)
  const chosen = picked ?? state.tally
  const apply = async (mode: TallyMode) => {
    if (await send('stats/tally', { mode })) setPicked(null)
  }

  return (
    <div className="settings__field tally-settings">
      <FieldHead label={t.tally.where} hint={t.tally.whereHint} />
      <TallyModes chosen={chosen} current={state.tally} disabled={sending} onPick={setPicked} />
      {chosen === 'server' ? (
        <TallyServerFields key={state.tally ?? 'none'} state={state} onDone={() => setPicked(null)} />
      ) : (
        chosen !== null &&
        chosen !== state.tally && (
          <div className="account__actions">
            <button type="button" className="button button--primary" disabled={sending} onClick={() => void apply(chosen)}>
              {t.tally.apply}
            </button>
            <button type="button" className="button" disabled={sending} onClick={() => setPicked(null)}>
              {t.common.cancel}
            </button>
          </div>
        )
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

const valueOf = (state: EvenKeelState, name: string) => state.secrets.variables.find((each) => each.name === name)
const FIELDS = ['host', 'port', 'name', 'readerPassword', 'writerPassword'] as const
type Field = (typeof FIELDS)[number]
const VARIABLES: Record<Field, string> = {
  host: 'TALLY_DB_HOST',
  port: 'TALLY_DB_PORT',
  name: 'TALLY_DB_NAME',
  readerPassword: 'TALLY_READER_PASSWORD',
  writerPassword: 'TALLY_WRITER_PASSWORD',
}
const LABELS: Record<Field, () => string> = {
  host: () => t.tally.host,
  port: () => t.tally.port,
  name: () => t.tally.database,
  readerPassword: () => t.tally.readerPassword,
  writerPassword: () => t.tally.writerPassword,
}
const isPassword = (field: Field) => field === 'readerPassword' || field === 'writerPassword'

interface ServerProps {
  state: EvenKeelState
  onDone: () => void
  onCancel?: () => void
}

/** The user's own Postgres: prefilled from `.env`, a password left blank keeps the one there; the service checks before saving. */
export function TallyServerFields({ state, onDone, onCancel }: ServerProps) {
  const { send, sending, failure } = useCommand()
  const [server, setServer] = useState<Record<Field, string>>(
    () => Object.fromEntries(FIELDS.map((field) => [field, isPassword(field) ? '' : (valueOf(state, VARIABLES[field])?.value ?? '')])) as Record<Field, string>,
  )

  // The port falls back to 5432 and a blank password keeps the one in `.env`; anything else empty is refused (`tally.incomplete`).
  const incomplete = FIELDS.some((field) => field !== 'port' && server[field].trim() === '' && !(isPassword(field) && valueOf(state, VARIABLES[field])?.set))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('stats/tally', { mode: 'server', server })) onDone()
  }

  return (
    <form className="tally-server" onSubmit={(event) => void submit(event)}>
      {FIELDS.map((field) => (
        <label key={field} className={`tally-server__field tally-server__field--${field}`}>
          <span className="tally-server__label">{LABELS[field]()}</span>
          <input
            className="account__input"
            type={isPassword(field) ? 'password' : 'text'}
            inputMode={field === 'port' ? 'numeric' : undefined}
            value={server[field]}
            placeholder={field === 'port' ? '5432' : isPassword(field) && valueOf(state, VARIABLES[field])?.set ? t.tally.passwordKept : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setServer({ ...server, [field]: event.target.value })}
          />
        </label>
      ))}
      <div className="account__actions tally-server__actions">
        <button type="submit" className="button button--primary" disabled={sending || incomplete}>
          {sending ? t.tally.checking : t.tally.save}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="button" disabled={sending} onClick={onCancel}>
            {t.tally.back}
          </button>
        )}
      </div>
      {failure !== null && (
        <p className="notice notice--error tally-server__failure" role="alert">
          {say(failure)}
        </p>
      )}
    </form>
  )
}
