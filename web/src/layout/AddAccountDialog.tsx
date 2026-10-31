import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { AccountLogin, AccountView } from '../../../src/account/model.js'
import { addDepth, addOf, dirty, freshKeys, wayGiven, WAYS, withAdd, withoutAdd, type AddAt, type Draft, type Drafts, type Way } from '../accountAdd.js'
import { cliMissing, deviceLogin, PROVIDERS, type Provider } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useLive } from '../live/context.js'
import { CliDownloadDialog } from './CliCopies.js'
import { HelpTip } from '../pages/settingsParts.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { CheckIcon, CodexIcon, CopilotIcon, GiftIcon, KeyIcon, TerminalIcon } from '../ui/icons.js'
import { AgentIcon, LOGIN_FOCUS, LoginSteps } from './accountParts.js'
import '../tools/addPackage.css'
import './accountAdd.css'

/** `--motion-mark` in styles.css: the glow of a new account's card. */
const GLOW_MS = 1600
/** A mark the list did not pick up by then (the dialog closed over another page) is dropped. */
const ARRIVAL_MS = 20_000

let arrival: { before: Set<string>; until: number } | null = null

/** The accounts of `keys` added by the dialog just now, for the list to light up once. */
export function useFreshAccounts(keys: string[]): string[] {
  const fresh = arrival !== null && Date.now() < arrival.until ? freshKeys(arrival.before, keys) : []
  const seen = fresh.join(' ')
  useEffect(() => {
    if (seen === '') return
    const timer = setTimeout(() => (arrival = null), GLOW_MS)
    return () => clearTimeout(timer)
  }, [seen])
  return fresh
}

/** Opens the add dialog over the current page: at the provider pick (null) or at a provider's ways. */
export function useOpenAdd(): (provider: Provider | null) => void {
  const location = useLocation()
  const navigate = useNavigate()
  return (provider) => void navigate({ pathname: location.pathname, search: withAdd(location.search, provider) }, { state: { adding: 1 } })
}

/**
 * Adding an account, over the page it was opened from (BTN-352): the address holds the step (`?addAccount=<provider>&addWay=<id>`),
 * so a reload and the browser's Back keep it; what is typed lives here, so stepping back and forth keeps it too.
 */
export function AddAccountDialog({ account }: { account: AccountView }) {
  const location = useLocation()
  const at = addOf(new URLSearchParams(location.search))
  return at === null ? null : <AddDialog account={account} at={at} />
}

type Ask = 'discard' | 'stopClose' | 'stopBack'

interface WayText {
  title: string
  gets: string
  tip: string
  next: string
  rule: string
  action: string
}

function wayText(provider: Provider, way: Way): WayText {
  return (t.addAccount.way[provider] as Record<string, WayText>)[way.id]!
}

function wayIcon(provider: Provider, way: Way): ReactNode {
  if (way.kind === 'key') return <KeyIcon />
  if (way.id === 'chatgpt') return <CodexIcon />
  if (way.id === 'copilot') return <CopilotIcon />
  if (way.id === 'free') return <GiftIcon />
  if (way.id === 'machine') return <TerminalIcon />
  return <AgentIcon agent={provider} />
}

const FOCUS = `.account-add__use-cli, .account-add__way input:checked, .add-package__kind:not([aria-disabled]), ${LOGIN_FOCUS}`

function AddDialog({ account, at }: { account: AccountView; at: AddAt }) {
  const location = useLocation()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const { send, sending, failure } = useCommand()
  const [drafts, setDrafts] = useState<Drafts>({})
  const [asking, setAsking] = useState<Ask | null>(null)
  const before = useRef(account.accounts.map((entry) => entry.key))
  const { login } = account
  const running = login !== null && login.error === null
  const depth = addDepth(location.state)
  // The step came from the provider pick here, so "Back" goes to it.
  const picked = (location.state as { picked?: unknown } | null)?.picked === true
  const { state: live } = useLive()
  const copy = at.provider !== null ? live?.cliCopies?.[at.provider] : undefined
  // A provider with no CLI to run asks for one over the provider pick (BTN-599): closing that leaves the pick open.
  const copyNeeded = copy !== undefined && (copy.source === 'checked' && copy.status !== 'ready' || copy.source === 'system' && !copy.system) ? at.provider : null
  const provider = at.provider !== null && copyNeeded === null && !cliMissing(account, at.provider) ? at.provider : null
  const newAccount = wayGiven(new URLSearchParams(location.search))
  const [checked, setChecked] = useState<string | null>(null)
  useEffect(() => {
    if (provider === null || newAccount || login !== null) return
    let cancelled = false
    setChecked(null)
    void send('account/discover', { agent: provider }).then(() => {
      if (!cancelled) setChecked(provider)
    })
    return () => { cancelled = true }
  }, [provider, newAccount, login !== null])
  const checking = provider !== null && !newAccount && checked !== provider
  const candidate = !newAccount && checked === provider && account.globalCheck?.agent === provider ? account.globalCheck.account : null
  const shown = login === null ? provider : (PROVIDERS.find((each) => each === login.agent) ?? provider)
  const step = login !== null ? 'login' : checking ? 'checking' : candidate != null ? 'existing' : `${provider ?? 'pick'}:${newAccount}`

  // Closing goes back over the entries the dialog pushed; one opened by its address has the dialog under them too, and
  // that entry is then replaced by the page alone.
  const leaving = useRef(false)
  const close = () => {
    if (depth === 0) {
      void navigate({ pathname: location.pathname, search: withoutAdd(location.search) }, { replace: true })
      return
    }
    leaving.current = true
    void navigate(-depth)
  }
  useEffect(() => {
    if (!leaving.current) return
    leaving.current = false
    void navigate({ pathname: location.pathname, search: withoutAdd(location.search) }, { replace: true })
  }, [location.key])
  const done = () => {
    arrival = { before: new Set(before.current), until: Date.now() + ARRIVAL_MS }
    close()
  }

  // A sign-in of a new account that ends with no error and no cancel from here has added it.
  const seen = useRef<AccountLogin | null>(login)
  const quit = useRef(false)
  useEffect(() => {
    const last = seen.current
    seen.current = login
    if (login !== null || last === null) return
    const stopped = quit.current
    quit.current = false
    if (last.error === null && last.target === null && !stopped) done()
  })

  // Before the effects of the dialogs inside, so one opened together with it stays on top.
  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(FOCUS)?.focus()
  }, [step])

  const cancelLogin = async () => {
    quit.current = true
    await send('account/cancel')
  }

  const leave = () => {
    if (running) return setAsking('stopClose')
    if (dirty(drafts)) return setAsking('discard')
    if (login !== null) void cancelLogin()
    close()
  }

  // A running sign-in is not dropped by a stray click or Escape: the link is opened in another tab and the way back passes here.
  const backdrop = useBackdropClose(dialog, () => !running && leave())

  const pick = (each: Provider) => {
    void navigate({ pathname: location.pathname, search: withAdd(location.search, each, drafts[each]?.way) }, { state: { adding: depth + 1, picked: true } })
  }
  const pickWay = (each: Provider, way: Way) => {
    setDrafts((current) => ({ ...current, [each]: { ...draftOf(current, each), way: way.id } }))
    void navigate({ pathname: location.pathname, search: withAdd(location.search, each, way.id) }, { replace: true, state: location.state })
  }

  const title = shown === null ? t.addAccount.title : t.addAccount.titleOf(t.account.agents[shown])
  return (
    <dialog
      ref={dialog}
      className="add-package account-add"
      aria-labelledby={heading}
      onCancel={(event) => {
        // React carries the Escape of a question asked over this dialog up to here too: that one is the question's.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        if (!running) leave()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={leave}>
            ×
          </button>
        </header>
        {login !== null ? (
          <>
            <div className="add-package__body">
              <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
              {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
            </div>
            {running && (
              <footer className="add-package__foot">
                <button type="button" className="button" disabled={sending} onClick={() => setAsking('stopBack')}>
                  ← {t.account.back}
                </button>
                <span className="add-package__spacer" />
              </footer>
            )}
          </>
        ) : provider === null ? (
          <ProviderPick account={account} onPick={pick} />
        ) : checking ? (
          <div className="add-package__body" role="status">{t.addAccount.checkingCli}</div>
        ) : candidate != null ? (
          <>
            <div className="add-package__body">
              <p className="add-package__note">{t.addAccount.existingCli}</p>
              <p className="add-package__label account-add__identity">{candidate.status.email ?? candidate.status.orgName ?? t.account.agents[provider]}</p>
              {failure !== null && <p className="notice notice--error" role="alert">{say(failure)}</p>}
            </div>
            <footer className="add-package__foot account-add__cli-foot">
              {picked && <button type="button" className="button" disabled={sending} onClick={() => void navigate(-1)}>← {t.account.back}</button>}
              <span className="add-package__spacer" />
              <button type="button" className="button" disabled={sending} onClick={() => void navigate(
                { pathname: location.pathname, search: withAdd(location.search, provider, WAYS[provider][0]!.id) },
                { state: { ...location.state, adding: depth + 1 } },
              )}>{t.addAccount.otherAccount}</button>
              <button type="button" className="button button--primary account-add__use-cli" disabled={sending} onClick={async () => {
                before.current = account.accounts.map((entry) => entry.key)
                if (await send('account/global', { agent: provider })) done()
              }}>{t.addAccount.useCli}</button>
            </footer>
          </>
        ) : (
          <Ways
            provider={provider}
            way={at.way ?? WAYS[provider][0]!}
            draft={draftOf(drafts, provider)}
            onDraft={(draft) => setDrafts((current) => ({ ...current, [provider]: draft }))}
            onPick={(way) => pickWay(provider, way)}
            back={picked ? () => void navigate(-1) : null}
            sending={sending}
            failure={failure === null ? null : say(failure)}
            onSubmit={async (way, draft) => {
              before.current = account.accounts.map((entry) => entry.key)
              if (way.kind === 'key') {
                if (await send('account/api', { name: draft.name, key: draft.key, agent: provider })) done()
                return
              }
              const added = await send('account/add', { agent: provider, ...(way.method !== undefined && { method: way.method }) })
              if (added && way.kind === 'instant') done()
            }}
          />
        )}
      </div>
      {copyNeeded !== null && (
        <CliDownloadDialog
          key={copyNeeded}
          provider={copyNeeded}
          stay
          onClose={() => void (picked ? navigate(-1) : navigate({ pathname: location.pathname, search: withAdd(location.search, null) }, { replace: true, state: location.state }))}
        />
      )}
      {asking === 'discard' && (
        <ConfirmDialog
          {...t.addAccount.discard}
          busy={false}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            close()
          }}
        />
      )}
      {(asking === 'stopClose' || asking === 'stopBack') && (
        <ConfirmDialog
          {...t.addAccount.stop}
          busy={sending}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            const then = asking
            setAsking(null)
            void cancelLogin().then(() => then === 'stopClose' && close())
          }}
        />
      )}
    </dialog>
  )
}

function draftOf(drafts: Drafts, provider: Provider): Draft {
  return drafts[provider] ?? { name: '', key: '', way: WAYS[provider][0]!.id }
}

/** Whose account it is, when the opener did not say: a provider whose CLI is not found is off, saying where to get it. */
function ProviderPick({ account, onPick }: { account: AccountView; onPick: (provider: Provider) => void }) {
  return (
    <div className="add-package__body">
      <p className="add-package__note">{t.addAccount.providerLead}</p>
      <div className="add-package__kinds account-add__providers">
        {PROVIDERS.map((provider) => {
          const missing = cliMissing(account, provider)
          return (
            <button
              key={provider}
              type="button"
              className="add-package__kind"
              onClick={() => onPick(provider)}
            >
              <span className="add-package__kind-icon">
                <AgentIcon agent={provider} />
              </span>
              <span className="add-package__kind-title">{t.account.agents[provider]}</span>
              {missing && <span className="tag account-add__missing">{t.account.cliNotFound}</span>}
              <span className="add-package__kind-hint">{providerHint(provider)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface WaysProps {
  provider: Provider
  way: Way
  draft: Draft
  onDraft: (draft: Draft) => void
  onPick: (way: Way) => void
  /** Back to the provider pick; null — the provider came from the opener. */
  back: (() => void) | null
  sending: boolean
  failure: string | null
  onSubmit: (way: Way, draft: Draft) => Promise<void>
}

/** The ways a provider's account signs in, as cards to pick one from, what the picked one needs under them, and its one action. */
function Ways({ provider, way, draft, onDraft, onPick, back, sending, failure, onSubmit }: WaysProps) {
  const group = useId()
  const text = wayText(provider, way)
  const key = way.kind === 'key'
  const ready = !sending && (!key || draft.key.trim() !== '')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready) void onSubmit(way, draft)
  }
  // Enter on a picked card does the step's action, as it does in a field.
  const enter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.target.type !== 'radio') return
    event.preventDefault()
    event.currentTarget.requestSubmit()
  }

  return (
    <form className="add-package__form" onSubmit={submit} onKeyDown={enter}>
      <div className="add-package__body">
        <fieldset className="add-package__field">
          <legend className="add-package__label add-package__legend">{t.addAccount.ways}</legend>
          <div className="account-add__ways">
            {WAYS[provider].map((each) => {
              const card = wayText(provider, each)
              return (
                <label key={each.id} className="account-add__way">
                  <input type="radio" name={group} value={each.id} checked={each.id === way.id} onChange={() => onPick(each)} />
                  <span className="account-add__way-icon">{wayIcon(provider, each)}</span>
                  <span className="account-add__way-title">
                    {card.title}
                    <HelpTip text={card.tip} align="start" />
                  </span>
                  <span className="account-add__way-check">
                    <CheckIcon />
                  </span>
                  <span className="account-add__way-gets">{card.gets}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
        <p className="add-package__note">{text.next}</p>
        {text.rule !== '' && <p className="add-package__note">{text.rule}</p>}
        {key && (
          <>
            <label className="add-package__field">
              <span className="add-package__label">{t.addAccount.key[way.id === 'token' ? 'token' : 'key']}</span>
              <input
                className="add-package__input add-package__input--mono"
                type="password"
                value={draft.key}
                onChange={(event) => onDraft({ ...draft, key: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="add-package__field">
              <span className="add-package__label">{t.addAccount.name}</span>
              <input
                className="add-package__input"
                value={draft.name}
                onChange={(event) => onDraft({ ...draft, name: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </>
        )}
        {failure !== null && (
          <p className="notice notice--error" role="alert">
            {failure}
          </p>
        )}
      </div>
      <footer className="add-package__foot">
        {back !== null && (
          <button type="button" className="button" disabled={sending} onClick={back}>
            ← {t.account.back}
          </button>
        )}
        <span className="add-package__spacer" />
        <button type="submit" className="button button--primary" disabled={!ready}>
          {text.action}
        </button>
      </footer>
    </form>
  )
}
import { providerHint } from '../accountAdd.js'
