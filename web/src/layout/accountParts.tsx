import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { launchBlock, loginBlockNotice, removeProblem, type AccountEntry, type AccountLogin, type AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { limitSpans } from '../../../src/limits/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import type { AccountTokens } from '../../../src/stats/model.js'
import { loginRow, retryBody, type LoginRow } from '../accountAdd.js'
import { accountName, agentLabel } from '../accountName.js'
import { connectionOf, type Connection } from '../accounts.js'
import { formatAgo, formatTokens } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { loginLeft } from '../state.js'
import { loadedData, useStatsAnswer } from '../stats/common.js'
import { formatUsd } from '../stats/format.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { ClaudeIcon, CodexIcon, CopilotIcon, KeyIcon, OpenCodeIcon, TerminalIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import './accountAdd.css'

export type Send = (name: string, body?: Record<string, unknown>) => Promise<boolean>

/** Today's spend in dollars by account folder key; null while Tally has not answered. */
export type Spend = Record<string, number> | null

/** Today's spend by account folder from Tally, read only while there is an API account to show it for. */
export function useSpend(account: AccountView): Spend {
  const { statsSpend } = useLive()
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const wanted = account.accounts.some(spendsByKey)
  return loadedData(useStatsAnswer(wanted ? `spend|${tz}` : null, () => statsSpend(tz)))
}

/** The tokens of today and of 30 days by account folder key; null while Tally has not answered. */
export type Tokens = Record<string, AccountTokens> | null

/** The tokens from Tally, read only while there is an account whose limit nothing tells to show them for (BTN-342). */
export function useTokens(account: AccountView): Tokens {
  const { statsTokens } = useLive()
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const wanted = account.accounts.some((entry) => limitsNote(entry) !== null)
  return loadedData(useStatsAnswer(wanted ? `tokens|${tz}` : null, () => statsTokens(tz)))
}

/**
 * What an account whose limit nothing tells shows instead of windows (BTN-342): why there are none, the tokens it carried
 * by Tally, and when it last hit its limit, so one that keeps hitting it shows even with no ceiling known. `why`: `line`
 * — on a line of its own; `tip` — the drawer's way, in the tip of the tokens; `plain` — on a line, inside a card that is
 * itself a tip, so no tip of its own.
 */
export function UnknownLimit({ entry, tokens, now, className, why }: { entry: AccountEntry; tokens: Tokens; now: Date; className: string; why: 'line' | 'tip' | 'plain' }) {
  const counted = tokens === null ? null : (tokens[entry.key] ?? { day: 0, month: 0 })
  const text = counted === null ? t.account.tokensNone : t.account.tokens(formatTokens(counted.day), formatTokens(counted.month))
  const tip = why === 'tip' ? (
    <>
      <span>{limitsNote(entry)}</span>
      <span className="tip__muted">{t.account.tokensTitle}</span>
    </>
  ) : (
    t.account.tokensTitle
  )
  return (
    <>
      {why !== 'tip' && <p className={className}>{limitsNote(entry)}</p>}
      {why === 'plain' ? (
        <p className={className}>{text}</p>
      ) : (
        <Tipped className={why === 'tip' ? `${className} accounts__none` : className} tip={tip} align="start" focusable>
          {text}
        </Tipped>
      )}
      {entry.lastLimitAt != null && <p className={className}>{t.account.lastLimit(formatAgo(entry.lastLimitAt, now))}</p>}
    </>
  )
}

/**
 * A key account that shows today's spend for its limits. Copilot's token reads its monthly allowance instead and pays in
 * AI credits Tally does not price.
 */
export function spendsByKey(entry: AccountEntry): boolean {
  return entry.apiKey && entry.agent !== COPILOT
}

/**
 * The line an OpenCode or Copilot account shows instead of empty limit rows while its provider gave it no window — a
 * sign-in with none (OpenCode Zen, the machine's Copilot) or no answer yet — with why; `null` — it shows its windows
 * or spend (BTN-341).
 */
export function limitsNote(entry: AccountEntry): string | null {
  if ((entry.agent !== OPENCODE && entry.agent !== COPILOT) || spendsByKey(entry)) return null
  const limits = entry.limits
  if (limitSpans(limits).some((span) => (limits?.[span] ?? null) !== null)) return null
  return entry.usage.reason === null ? t.account.noLimits : `${t.account.noLimits} — ${say(entry.usage.reason)}`
}

/** The other accounts on the same subscription, whose limits are this one's too (`RateLimits.pool`); null — none. */
export function sharedLimitText(entry: AccountEntry, accounts: AccountEntry[]): string | null {
  const pool = entry.limits?.pool
  if (pool === undefined) return null
  const others = accounts.filter((each) => each.key !== entry.key && each.limits?.pool === pool)
  return others.length === 0 ? null : t.account.sharedLimit(others.map((each) => accountName(each, accounts)))
}

export function spendText(spend: Spend, key: string): string {
  if (spend === null) return t.account.todayNone
  return t.account.today(formatUsd(spend[key] ?? 0))
}

export function globalFolder(agent: string): string {
  return agent === CODEX ? '~/.codex' : '~/.claude'
}

const CONNECTION_ICONS: Record<Connection, () => ReactNode> = { cli: TerminalIcon, apiKey: KeyIcon }
const COPIED_MS = 2000

/**
 * Whose account it is and how it signs in, as two icons before the name: the agent's in the account's colour, so two
 * folders of one e-mail (Claude and Codex) or of look-alike names still read apart. Pointed at, it names both and
 * gives the account's quiet details: the sign-in left, the folder, a configuration still on its way. `dot` — the drawer's
 * way: the colour as a dot before a plain agent icon, the connection only in the tip.
 */
export function AccountMark({ entry, now, dot = false }: { entry: AccountEntry; now: Date; dot?: boolean }) {
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
    <Tipped className={dot ? 'account-mark account-mark--dot' : 'account-mark'} tip={tip} align="start" focusable>
      {dot && <span className="accounts__dot" />}
      <span className="account-mark__agent">
        <AgentIcon agent={entry.agent} />
      </span>
      {!dot && <Connected />}
    </Tipped>
  )
}

export function AgentIcon({ agent }: { agent: string }) {
  if (agent === OPENCODE) return <OpenCodeIcon />
  if (agent === COPILOT) return <CopilotIcon />
  return agent === CODEX ? <CodexIcon /> : agent === CLAUDE ? <ClaudeIcon /> : <span className="accounts__dot" />
}

/** Why an account without limits has none, as one sentence; null when it has them or pays from a key. */
export function staleText(entry: AccountEntry): string | null {
  if (spendsByKey(entry) || entry.limits !== null || entry.usage.state !== 'stale') return null
  return `${t.account.noLimits}${staleNote(entry.usage.reason)}`
}

interface NameProps {
  entry: AccountEntry
  /** Every account of the view, so that two folders without a name or an e-mail are numbered apart. */
  accounts: AccountEntry[]
  /** In one weight, without the e-mail's domain dimmed. */
  whole?: boolean
  /** The card's way: a click turns the name into a field that renames the account (`account/name`). */
  send?: Send
  sending?: boolean
}

const NAME_LENGTH = 80

/**
 * The name with the e-mail's domain dimmed, so that a column of accounts reads by the part that differs. Renamed, as
 * the project's name: Enter or leaving the field saves, Esc gives up, empty goes back to the default name. Only the
 * name in `state/account.json` changes, never the folder.
 */
export function AccountName({ entry, accounts, whole = false, send, sending = false }: NameProps) {
  const [text, setText] = useState<string | null>(null)
  // Esc and Enter end the edit before the field's blur does; the blur then has nothing left to save.
  const editing = useRef(false)
  const name = accountName(entry, accounts)
  const at = entry.name === null && !whole ? name.lastIndexOf('@') : -1
  const shown = (
    <>
      {at > 0 ? name.slice(0, at) : name}
      {at > 0 && <span className="accounts__domain">{name.slice(at)}</span>}
    </>
  )
  if (send === undefined) {
    return (
      <span className="accounts__email" title={name}>
        {shown}
      </span>
    )
  }
  const finish = (save: boolean) => {
    if (!editing.current) return
    editing.current = false
    const next = text?.trim() ?? ''
    setText(null)
    if (save && next !== (entry.name ?? '')) void send('account/name', { account: entry.key, name: next })
  }
  if (text === null) {
    return (
      <button
        type="button"
        className="accounts__email accounts__rename"
        title={t.account.rename(name)}
        disabled={sending}
        onClick={() => {
          editing.current = true
          setText(entry.name ?? '')
        }}
      >
        {shown}
      </button>
    )
  }
  return (
    <input
      className="accounts__name-input"
      aria-label={t.account.keyName}
      placeholder={accountName({ ...entry, name: null }, accounts)}
      maxLength={NAME_LENGTH}
      autoFocus
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        finish(event.key === 'Enter')
      }}
    />
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
  /** The drawer's way: as `bare`, but the actions stay next to their lines. */
  quiet?: boolean
}

/** The exceptions of an account, each with its action: sign-in needed or ending, removal pending, configuration pending, a failed check. */
export function AccountNotes({ entry, view, now, sending, send, bare = false, quiet = false }: NotesProps) {
  const left = loginLeft(entry.loginExpiresAt, now)
  const actions = (button: ReactNode) => (bare ? null : button)
  const brief = bare || quiet
  const stale = staleText(entry)
  const held = launchBlock(view, entry.key)

  return (
    <>
      {!brief && stale !== null && <p className="accounts__note">{stale}</p>}
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
      {!brief && entry.configPending && <p className="accounts__note">{t.account.configPending}</p>}
      {entry.error !== null &&
        (brief ? (
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
export function NoteActions({ entry, view, now, sending, send }: Omit<NotesProps, 'bare' | 'quiet'>) {
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

/**
 * Through what a Claude account's new sessions run, by `execution.claude`: a quiet line, since the setting on /settings
 * decides it; a subscription account carries Anthropic's rule on the Agent SDK in the tip.
 */
export function TransportNote({ entry }: Pick<NotesProps, 'entry'>) {
  const { transport } = entry
  if (transport === undefined || entry.removing) return null
  return (
    <Tipped
      className="accounts__note accounts__note--tipped"
      tip={
        <>
          <p>{t.account.transportWhere}</p>
          {transport === 'sdk' && !entry.apiKey && <p>{t.account.transportTerms}</p>}
        </>
      }
      align="start"
      focusable
    >
      {t.account.transportVia(t.account.transport[transport])}
    </Tipped>
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
  return (
    <div className="account__actions">
      <button type="button" className="button button--small" disabled={sending} onClick={() => setConfirming(true)}>
        {t.common.remove}
      </button>
      {confirming && (
        <ConfirmDialog
          title={accountName(entry, view.accounts)}
          question={removeQuestion(entry)}
          confirm={t.common.remove}
          cancel={t.account.keep}
          busy={sending}
          onConfirm={() => void send('account/remove', { account: entry.key }).then(() => setConfirming(false))}
          onClose={() => setConfirming(false)}
        />
      )}
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
  return t.account.loginTo(target === undefined ? login.target : accountName(target, accounts))
}

/** What a dialog with the sign-in focuses first: the link, else the code field, else its first button — not the ×. */
export const LOGIN_FOCUS = '.login-rows__link, .account__input, .account__actions button'

interface StepsProps {
  login: AccountLogin
  /** A device sign-in, Codex's or OpenCode's: its one-time code goes on the sign-in page, so no code field. */
  device: boolean
  sending: boolean
  send: Send
}

/**
 * The sign-in through an agent's CLI as numbered rows — open the link, sign in, the code — the current one marked; a
 * failed one gives its error and "Try again" instead. The way out is the dialog's own.
 */
export function LoginSteps({ login, device, sending, send }: StepsProps) {
  const [code, setCode] = useState('')
  const [opened, setOpened] = useState(false)
  const [coding, setCoding] = useState(false)
  // A device sign-in whose code was not read keeps its output open: the code is only there.
  const outputOpen = device && login.deviceCode === null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('account/code', { code })) setCode('')
  }

  if (login.error !== null) {
    return (
      <>
        <p className="notice notice--error">{say(login.error)}</p>
        <div className="account__actions">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void send(...retryBody(login))}>
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

  const row = loginRow(login, { opened, coding })
  const at = (each: LoginRow) => ({ className: `login-rows__row${each === row ? ' login-rows__row--on' : ''}`, 'aria-current': each === row ? ('step' as const) : undefined })
  const hint = device ? t.addAccount.picksUp : login.codeSent ? t.account.codeSent : null
  return (
    <>
      <ol className="login-rows">
        <li {...at('open')}>
          <span className="login-rows__label">{t.addAccount.rows.open}</span>
          {login.urls.length === 0 ? (
            <span className="login-rows__wait">{t.account.waitingLink}</span>
          ) : (
            <span className="login-rows__links">
              {login.urls.map((url) => (
                <a key={url} className="button login-rows__link" href={url} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>
                  {new URL(url).host} ↗
                </a>
              ))}
            </span>
          )}
        </li>
        <li {...at('signIn')}>
          <span className="login-rows__label">{t.addAccount.rows.signIn}</span>
        </li>
        <li {...at('code')}>
          <span className="login-rows__label">{device ? t.addAccount.rows.deviceCode : t.addAccount.rows.code}</span>
          {device ? (
            login.deviceCode !== null && <DeviceCode key={login.deviceCode} code={login.deviceCode} onCopy={() => setCoding(true)} />
          ) : (
            <form className="login-rows__code" onSubmit={(event) => void submit(event)}>
              <input
                className="account__input"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onFocus={() => setCoding(true)}
                placeholder={t.account.code}
                aria-label={t.account.code}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="button" disabled={sending || code.trim() === ''}>
                {t.account.send}
              </button>
            </form>
          )}
        </li>
      </ol>
      {hint !== null && <p className="login-rows__hint">{hint}</p>}
      {login.output !== '' && <Output text={login.output} open={outputOpen} />}
    </>
  )
}

/** A device sign-in's one-time code, large and apart from the CLI output, with a button that copies it. */
function DeviceCode({ code, onCopy }: { code: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    const place = event.currentTarget.parentElement
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Plain HTTP from another host has no clipboard API: copy the old way, from a field next to the button.
      const area = document.createElement('textarea')
      area.value = code
      place?.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    onCopy()
  }

  return (
    <div className="account__device-row">
      <code className="account__device-code" aria-label={t.account.deviceCode}>
        {code}
      </code>
      <button type="button" className="button" onClick={(event) => void copy(event)}>
        {copied ? t.account.codeCopied : t.account.copyCode}
      </button>
    </div>
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
