import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { launchBlock, loginBlockNotice, removeProblem, type AccountEntry, type AccountLogin, type AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import type { Notice } from '../../../src/notice/notice.js'
import { connectionOf, PROVIDERS, type Connection } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { loginLeft } from '../state.js'
import { loadedData, useStatsAnswer } from '../stats/common.js'
import { formatUsd } from '../stats/format.js'
import { BracesIcon, ClaudeIcon, CodexIcon, KeyIcon, TerminalIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'

export type Send = (name: string, body?: Record<string, unknown>) => Promise<boolean>

/** Today's spend in dollars by account folder key; null while Tally has not answered. */
export type Spend = Record<string, number> | null

/** Today's spend by account folder from Tally, read only while there is an API account to show it for. */
export function useSpend(account: AccountView): Spend {
  const { statsSpend } = useLive()
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const wanted = account.accounts.some((entry) => entry.apiKey)
  return loadedData(useStatsAnswer(wanted ? `spend|${tz}` : null, () => statsSpend(tz)))
}

export function spendText(spend: Spend, key: string): string {
  if (spend === null) return t.account.todayNone
  return t.account.today(formatUsd(spend[key] ?? 0))
}

export function accountName(entry: AccountEntry): string {
  return entry.name ?? entry.status?.email ?? (entry.global ? t.account.globalOf(globalFolder(entry.agent)) : entry.key)
}

export function globalFolder(agent: string): string {
  return agent === CODEX ? '~/.codex' : '~/.claude'
}

/** The agent of an account as the page names it; one the page does not know yet by its registry name. */
export function agentLabel(agent: string): string {
  const provider = PROVIDERS.find((each) => each === agent)
  return provider === undefined ? agent : t.account.agents[provider]
}

const CONNECTION_ICONS: Record<Connection, () => ReactNode> = { cli: TerminalIcon, sdk: BracesIcon, apiKey: KeyIcon }

/**
 * Whose account it is and how it signs in, as two icons before the name: the agent's in the account's colour, so two
 * folders of one e-mail (Claude and Codex) or of look-alike names still read apart. Pointed at, it names both and
 * gives the account's quiet details: the sign-in left, the folder, a configuration still on its way.
 */
export function AccountMark({ entry, now }: { entry: AccountEntry; now: Date }) {
  const connection = connectionOf(entry)
  const Connected = CONNECTION_ICONS[connection]
  const left = loginLeft(entry.loginExpiresAt, now)
  const tip = (
    <>
      <span className="tip__head">
        {agentLabel(entry.agent)} · {t.account.connections[connection]}
      </span>
      {!entry.apiKey && entry.loginExpiresAt !== null && !left.renew && !entry.needsLogin && <span>{t.account.expiry(left.text)}</span>}
      <span>{t.account.folder(entry.global ? globalFolder(entry.agent) : entry.key)}</span>
      {entry.configPending && <span className="tip__muted">{t.account.configPending}</span>}
    </>
  )
  return (
    <Tipped className="account-mark" tip={tip} align="start" focusable>
      <span className="account-mark__agent">
        <AgentIcon agent={entry.agent} />
      </span>
      <Connected />
    </Tipped>
  )
}

export function AgentIcon({ agent }: { agent: string }) {
  return agent === CODEX ? <CodexIcon /> : agent === CLAUDE ? <ClaudeIcon /> : <span className="accounts__dot" />
}

/** Why an account without limits has none, as one sentence; null when it has them or pays from a key. */
export function staleText(entry: AccountEntry): string | null {
  if (entry.apiKey || entry.limits !== null || entry.usage.state !== 'stale') return null
  return `${t.account.noLimits}${staleNote(entry.usage.reason)}`
}

/** The name with the e-mail's domain dimmed, so that a column of accounts reads by the part that differs. */
export function AccountName({ entry }: { entry: AccountEntry }) {
  const name = accountName(entry)
  const at = entry.name === null ? name.lastIndexOf('@') : -1
  return (
    <span className="accounts__email" title={name}>
      {at > 0 ? name.slice(0, at) : name}
      {at > 0 && <span className="accounts__domain">{name.slice(at)}</span>}
    </span>
  )
}

interface NotesProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  sending: boolean
  send: Send
  /**
   * The card's way: the actions go to its foot (`NoteActions`), why there are no limits to their cells, a configuration
   * on its way to the mark's tip, a failed check is one short line with the error on pointing.
   */
  bare?: boolean
}

/** The exceptions of an account, each with its action: sign-in needed or ending, removal pending, configuration pending, a failed check. */
export function AccountNotes({ entry, view, now, sending, send, bare = false }: NotesProps) {
  const left = loginLeft(entry.loginExpiresAt, now)
  const actions = (button: ReactNode) => (bare ? null : button)
  const stale = staleText(entry)
  const held = launchBlock(view, entry.key)

  return (
    <>
      {!bare && stale !== null && <p className="accounts__note">{stale}</p>}
      {held?.code === 'account.extraFree' && <p className="accounts__note accounts__note--warn">{say(held)}</p>}
      {entry.apiKey && entry.needsLogin && <p className="accounts__note accounts__note--warn">{t.account.apiKeyLost}</p>}
      {!entry.apiKey && (left.renew || entry.needsLogin) && (
        <div className="accounts__note accounts__note--warn">
          <span>{entry.needsLogin ? t.account.needsLogin : t.account.expiry(left.text)}</span>
          {actions(<RenewButton entry={entry} view={view} sending={sending} send={send} />)}
        </div>
      )}
      {entry.removing && (
        <div className="accounts__note accounts__note--warn">
          <span>
            {t.account.removing}
            {entry.sessions.length > 0 ? t.account.removingAlive(entry.sessions.join(', ')) : ''}
          </span>
          {actions(<KeepButton entry={entry} sending={sending} send={send} />)}
        </div>
      )}
      {!bare && entry.configPending && <p className="accounts__note">{t.account.configPending}</p>}
      {entry.error !== null &&
        (bare ? (
          <Tipped className="accounts__note accounts__note--tipped" tip={say(entry.error)} align="start" focusable>
            {t.account.checkFailedShort}
          </Tipped>
        ) : (
          <p className="accounts__note">{t.account.checkFailed(say(entry.error))}</p>
        ))}
    </>
  )
}

/** The buttons `AccountNotes` leaves out when `bare`: renew the sign-in, keep a folder being removed. */
export function NoteActions({ entry, view, now, sending, send }: Omit<NotesProps, 'bare'>) {
  const left = loginLeft(entry.loginExpiresAt, now)
  return (
    <>
      {!entry.apiKey && (left.renew || entry.needsLogin) && <RenewButton entry={entry} view={view} sending={sending} send={send} />}
      {entry.removing && <KeepButton entry={entry} sending={sending} send={send} />}
    </>
  )
}

/** Greyed while a chain holds the active account, with why on pointing or focus. */
function RenewButton({ entry, view, sending, send }: Omit<NotesProps, 'now' | 'bare'>) {
  const held = entry.key === view.active && view.loginBlock !== null ? view.loginBlock : null
  const label = entry.needsLogin ? t.account.login : t.account.renew
  // Short on the button, next to the "sign-in: 4d" it renews; the full name is for screen readers.
  const name = entry.needsLogin ? undefined : t.account.renewFull
  if (held !== null) {
    return (
      <Tipped className="account__actions" tip={say(loginBlockNotice(held))} align="start">
        <button type="button" className="button button--small" aria-disabled="true" aria-label={name}>
          {label}
        </button>
      </Tipped>
    )
  }
  return (
    <button
      type="button"
      className="button button--small"
      aria-label={name}
      disabled={sending || view.login !== null}
      onClick={() => void send('account/renew', { account: entry.key })}
    >
      {label}
    </button>
  )
}

function KeepButton({ entry, sending, send }: Pick<NotesProps, 'entry' | 'sending' | 'send'>) {
  return (
    <button type="button" className="button button--small" disabled={sending} onClick={() => void send('account/keep', { account: entry.key })}>
      {t.account.keep}
    </button>
  )
}

function staleNote(reason: Notice | null): string {
  return reason === null ? t.account.staleExpired : t.account.staleBusy
}

interface RemoveProps {
  entry: AccountEntry
  view: AccountView
  sending: boolean
  send: Send
}

/** "Remove" behind a confirmation; a folder that is kept has it greyed, with why on pointing or focus. */
export function RemoveAction({ entry, view, sending, send }: RemoveProps) {
  const [confirming, setConfirming] = useState(false)
  const kept = removeProblem(view, entry.key)

  if (entry.removing) return null
  if (kept !== undefined) {
    return (
      <Tipped className="account__actions" tip={say(kept)} align="start">
        <button type="button" className="button button--small" aria-disabled="true">
          {t.common.remove}
        </button>
      </Tipped>
    )
  }
  if (!confirming) {
    return (
      <div className="account__actions">
        <button type="button" className="button button--small" disabled={sending} onClick={() => setConfirming(true)}>
          {t.common.remove}
        </button>
      </div>
    )
  }
  return (
    <div className="account__actions">
      <span className="accounts__confirm">{removeQuestion(entry)}</span>
      <button
        type="button"
        className="button button--small button--danger"
        disabled={sending}
        onClick={() => void send('account/remove', { account: entry.key }).then(() => setConfirming(false))}
      >
        {t.common.remove}
      </button>
      <button type="button" className="button button--small" disabled={sending} onClick={() => setConfirming(false)}>
        {t.common.cancel}
      </button>
    </div>
  )
}

function removeQuestion(entry: AccountEntry): string {
  const sessions = entry.sessions.join(', ')
  if (entry.apiKey) return sessions === '' ? t.account.removeKeyNow : t.account.removeKeyWhenDone(sessions)
  return sessions === '' ? t.account.removeNow : t.account.removeWhenDone(sessions)
}

export function loginHeading({ login, accounts }: AccountView): string {
  if (login === null) return t.account.add
  if (login.target === null) return t.account.loginNew
  const target = accounts.find((entry) => entry.key === login.target)
  return t.account.loginTo(target === undefined ? login.target : accountName(target))
}

interface StepsProps {
  login: AccountLogin
  /** Codex's device-auth: the code is in the CLI output and goes on the sign-in page, so no code field. */
  device: boolean
  sending: boolean
  send: Send
}

/** The sign-in through an agent's CLI: the link it printed, the code field, the way out. */
export function LoginSteps({ login, device, sending, send }: StepsProps) {
  const [code, setCode] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('account/code', { code })) setCode('')
  }

  if (login.error !== null) {
    const retry = () => (login.target === null ? send('account/add', { agent: login.agent }) : send('account/renew', { account: login.target }))
    return (
      <>
        <p className="notice notice--error">{say(login.error)}</p>
        <div className="account__actions">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void retry()}>
            {t.common.retry}
          </button>
          <button type="button" className="button" disabled={sending} onClick={() => void send('account/cancel')}>
            {t.common.close}
          </button>
        </div>
        {login.output !== '' && <Output text={login.output} />}
      </>
    )
  }

  return (
    <>
      {login.urls.length === 0 ? (
        <p className="queue__hint">{t.account.waitingLink}</p>
      ) : (
        <ul className="account__links">
          {login.urls.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {login.urls.length === 1 ? t.account.openLogin : new URL(url).host}
              </a>
            </li>
          ))}
        </ul>
      )}
      {device ? (
        <p className="queue__hint">{t.account.deviceHint}</p>
      ) : (
        <>
          <form className="account__code" onSubmit={(event) => void submit(event)}>
            <input
              className="account__input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t.account.code}
              aria-label={t.account.code}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="button" disabled={sending || code.trim() === ''}>
              {t.account.send}
            </button>
          </form>
          <p className="queue__hint">{login.codeSent ? t.account.codeSent : t.account.codeHint}</p>
        </>
      )}
      {device && login.output !== '' && <Output text={login.output} open />}
      <div className="account__actions">
        <button type="button" className="button" disabled={sending} onClick={() => void send('account/cancel')}>
          {t.account.cancelLogin}
        </button>
      </div>
      {!device && login.output !== '' && <Output text={login.output} />}
    </>
  )
}

function Output({ text, open = false }: { text: string; open?: boolean }) {
  return (
    <details className="account__output" open={open}>
      <summary>{t.account.output}</summary>
      <pre>{text}</pre>
    </details>
  )
}

interface ApiKeyProps {
  /** Whose key: Anthropic's for Claude, OpenAI's for Codex. */
  agent: string
  hint: string
  onDone: () => void
  onCancel: () => void
}

/** Its own command, so a refused key shows under the form rather than elsewhere on the page. */
export function ApiKeyFields({ agent, hint, onDone, onCancel }: ApiKeyProps) {
  const { send, sending, failure } = useCommand()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('account/api', { name, key, agent })) onDone()
  }

  return (
    <form className="account__key" onSubmit={(event) => void submit(event)}>
      <input
        className="account__input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t.account.keyName}
        aria-label={t.account.keyName}
        autoComplete="off"
        spellCheck={false}
      />
      <input
        className="account__input"
        type="password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder={t.account.keyValue}
        aria-label={t.account.keyValue}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="account__actions">
        <button type="submit" className="button button--primary" disabled={sending || key.trim() === ''}>
          {t.account.keyAdd}
        </button>
        <button type="button" className="button" disabled={sending} onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
      {failure !== null && (
        <p className="notice notice--error" role="alert">
          {say(failure)}
        </p>
      )}
      <p className="queue__hint">{hint}</p>
    </form>
  )
}
