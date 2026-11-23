import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { AccountEntry, AccountLogin, AccountView } from '../../../src/account/model.js'
import { addDepth, addOf, dirty, freshKeys, HUB_PLACE, onToken, placeOf, sameChoices, signsOf, tokenBody, wayGiven, WAYS, withAdd, withoutAdd, withPlace, type AddAt, type Draft, type Drafts, type Way } from '../accountAdd.js'
import { defaultPlace, type MachineAddChoice } from '../machineAdd.js'
import { machineLogin } from '../machineSignIn.js'
import { MachineAgents, PlacePick, type Place } from './AddAccountPlace.js'
import { cliMissing, deviceLogin, PROVIDERS, type Provider } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useLive } from '../live/context.js'
import { CliDownloadDialog } from './CliCopies.js'
import { HelpTip } from '../pages/settingsParts.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { CheckIcon, CloseIcon, CodexIcon, CopilotIcon, GiftIcon, KeyIcon, ServerIcon, TerminalIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import type { AwsProfiles, AzureCredentials, GcloudCredentials } from '../../../src/account/cloud.js'
import { cloudBody, cloudReady, EMPTY_CLOUD } from '../cloudDraft.js'
import { AgentIcon, LOGIN_FOCUS, LoginSteps, ProviderHint } from './accountParts.js'
import { CloudFields } from './CloudFields.js'
import { SignFields } from './SignFields.js'
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
  if (way.kind === 'cloud') return <ServerIcon />
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
  // A cloud account passed its check turn: the dialog says which model answered before it closes (BTN-822).
  const [cloudAdded, setCloudAdded] = useState(false)
  const before = useRef(account.accounts.map((entry) => entry.key))
  const { login } = account
  const running = login !== null && login.error === null
  const depth = addDepth(location.state)
  // The step came from the provider pick here, so "Back" goes to it.
  const picked = (location.state as { picked?: unknown } | null)?.picked === true
  const { state: live } = useLive()
  const copy = at.provider !== null ? live?.cliCopies?.[at.provider] : undefined
  // A provider with no CLI to run asks for one over the provider pick (BTN-599): closing that leaves the pick open.
  const copyNeeded = copy !== undefined && (copy.source !== 'system' && copy.status !== 'ready' || copy.source === 'system' && !copy.system) ? at.provider : null
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
  // Where it signs in, while the hub has machines elsewhere (BTN-1308); an opener that names the provider is the hub's.
  const machines = live?.machineSignIns ?? []
  const place = placeOf(new URLSearchParams(location.search))
  const onMachine = place === null || place === HUB_PLACE ? undefined : machines.find((each) => each.machine === place)
  const where = login === null && machines.length > 0 && at.provider === null && onMachine === undefined && place !== HUB_PLACE
  const machineBusy = sending || machineLogin(machines) !== undefined
  const step = cloudAdded ? 'cloudAdded' : login !== null ? 'login' : where ? 'where' : onMachine !== undefined ? `machine:${onMachine.machine}` : checking ? 'checking' : candidate != null ? 'existing' : `${provider ?? 'pick'}:${newAccount}`

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
    if (cloudAdded) return done()
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

  const next = (each: string) => {
    void navigate({ pathname: location.pathname, search: withPlace(location.search, each) }, { state: { adding: depth + 1, picked: true } })
  }
  const signOn = async (machine: string, { agent, method }: MachineAddChoice) => {
    if (await send('machines/login', { machine, agent, ...(method !== undefined && { method }) })) close()
  }
  const places = (): Place[] => [
    { id: HUB_PLACE, name: live?.machineNames?.[live.ownMachine ?? ''] ?? t.addAccount.place.hubName, color: live?.machineColors?.[live.ownMachine ?? ''], online: true },
    ...machines.map((each) => ({ id: each.machine, name: each.name, color: live?.machineColors?.[each.machine], online: each.online })),
  ]

  const title = login === null && onMachine !== undefined
    ? t.machinePanel.view.addTitle(onMachine.name)
    : shown === null ? t.addAccount.title : t.addAccount.titleOf(t.account.agents[shown])
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
            <CloseIcon />
          </button>
        </header>
        {cloudAdded ? (
          <CloudAdded account={account} before={before.current} onDone={done} />
        ) : login !== null ? (
          <>
            <div className="add-package__body">
              <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
            </div>
            {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
            {running && (
              <footer className="add-package__foot">
                <button type="button" className="button" disabled={sending} onClick={() => setAsking('stopBack')}>
                  ← {t.account.back}
                </button>
                <span className="add-package__spacer" />
              </footer>
            )}
          </>
        ) : where ? (
          <PlacePick places={places()} initial={defaultPlace(location.pathname, location.search, machines)} onNext={next} />
        ) : onMachine !== undefined ? (
          <MachineAgents
            machine={onMachine}
            accounts={account.accounts}
            busy={machineBusy}
            failure={failure === null ? null : say(failure)}
            back={picked ? () => void navigate(-1) : null}
            onPick={(choice) => void signOn(onMachine.machine, choice)}
            onAdded={close}
          />
        ) : provider === null ? (
          <ProviderPick account={account} onPick={pick} back={picked && machines.length > 0 ? () => void navigate(-1) : null} />
        ) : checking ? (
          <div className="add-package__body" role="status">{t.addAccount.checkingCli}</div>
        ) : candidate != null ? (
          <>
            <div className="add-package__body">
              <p className="add-package__note">{t.addAccount.existingCli}</p>
              <p className="add-package__label account-add__identity">{candidate.status.email ?? candidate.status.orgName ?? t.account.agents[provider]}</p>
            </div>
            {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
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
            aws={account.aws}
            readAws={() => void send('account/aws')}
            gcloud={account.gcloud}
            readGcloud={() => void send('account/gcloud')}
            azure={account.azure}
            readAzure={() => void send('account/azure')}
            accounts={account.accounts}
            onSubmit={async (way, draft) => {
              before.current = account.accounts.map((entry) => entry.key)
              if (onToken(provider, way, draft)) {
                if (await send('account/token', tokenBody(draft, sameChoices(account.accounts)))) done()
                return
              }
              if (way.kind === 'cloud') {
                if (await send('account/cloud', cloudBody(draft.name, draft.cloud ?? EMPTY_CLOUD))) setCloudAdded(true)
                return
              }
              if (way.kind === 'key') {
                if (await send('account/api', { name: draft.name, key: draft.key, agent: provider, ...(way.id === 'go' && { provider: 'opencode-go' }) })) done()
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

/** A cloud account passed its check: which model answered, then the list with the new card lit. */
function CloudAdded({ account, before, onDone }: { account: AccountView; before: string[]; onDone: () => void }) {
  const added = account.accounts.find((entry) => entry.cloud !== undefined && !before.includes(entry.key))
  return (
    <>
      <div className="add-package__body" role="status">
        <p className="add-package__label account-add__identity">{t.addAccount.cloud.added}</p>
        <p className="add-package__note">
          {added === undefined
            ? t.addAccount.cloud.waiting
            : added.checkedModel != null
              ? t.addAccount.cloud.answered(added.checkedModel)
              : t.addAccount.cloud.answeredNoModel}
        </p>
        {added?.cloud?.shortLived === true && <p className="notice notice--warn">{t.addAccount.cloud.shortLived[added.cloud.cloud]}</p>}
      </div>
      <footer className="add-package__foot">
        <span className="add-package__spacer" />
        <button type="button" className="button button--primary account-add__use-cli" onClick={onDone}>
          {t.addAccount.cloud.done}
        </button>
      </footer>
    </>
  )
}

function draftOf(drafts: Drafts, provider: Provider): Draft {
  return drafts[provider] ?? { name: '', key: '', way: WAYS[provider][0]!.id }
}

/** Whose account it is, when the opener did not say: a provider whose CLI is not found is off, saying where to get it. */
function ProviderPick({ account, onPick, back }: { account: AccountView; onPick: (provider: Provider) => void; back: (() => void) | null }) {
  return (
    <>
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
              <ProviderHint provider={provider} className="add-package__kind-hint" />
            </button>
          )
        })}
      </div>
    </div>
    {back !== null && (
      <footer className="add-package__foot">
        <button type="button" className="button" onClick={back}>
          ← {t.account.back}
        </button>
        <span className="add-package__spacer" />
      </footer>
    )}
    </>
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
  aws: AwsProfiles | undefined
  readAws: () => void
  gcloud: GcloudCredentials | undefined
  readGcloud: () => void
  azure: AzureCredentials | undefined
  readAzure: () => void
  accounts: AccountEntry[]
  onSubmit: (way: Way, draft: Draft) => Promise<void>
}

/** The ways a provider's account signs in, as cards to pick one from, what the picked one needs under them, and its one action. */
function Ways({ provider, way, draft, onDraft, onPick, back, sending, failure, aws, readAws, gcloud, readGcloud, azure, readAzure, accounts, onSubmit }: WaysProps) {
  const group = useId()
  const text = wayText(provider, way)
  const key = way.kind === 'key'
  const cloud = way.kind === 'cloud'
  const token = onToken(provider, way, draft)
  const ready = !sending && (token ? (draft.token ?? '').trim() !== '' : key ? draft.key.trim() !== '' : cloud ? cloudReady(draft.cloud ?? EMPTY_CLOUD) : true)
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
        {signsOf(provider, way) && <SignFields draft={draft} onDraft={onDraft} choices={sameChoices(accounts)} accounts={accounts} failure={failure} />}
        {!token && <p className="add-package__note">{text.next}</p>}
        {text.rule !== '' && <p className="add-package__note">{text.rule}</p>}
        {key && (
          <>
            <label className="add-package__field">
              <span className="add-package__label">{t.addAccount.key[way.id === 'token' ? 'token' : 'key']}</span>
              {/* A refusal of a key account is about the key (its form, the provider's answer), so it goes under the key. */}
              <FieldStrip line={failure === null ? null : { tone: 'error', text: failure }} fold wide>
                <input
                  className="add-package__input add-package__input--mono"
                  {...secretInput()}
                  value={draft.key}
                  aria-invalid={failure !== null}
                  onChange={(event) => onDraft({ ...draft, key: event.target.value })}
                />
              </FieldStrip>
            </label>
          </>
        )}
        {cloud && <CloudFields draft={draft.cloud ?? EMPTY_CLOUD} onDraft={(next) => onDraft({ ...draft, cloud: next })} aws={aws} readAws={readAws} gcloud={gcloud} readGcloud={readGcloud} azure={azure} readAzure={readAzure} />}
        {(key || cloud || token) && (
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
        )}
        {(cloud || token) && sending && (
          <p className="add-package__note" role="status">
            {token ? t.addAccount.sign.checking : t.addAccount.cloud.checking}
          </p>
        )}
      </div>
      {failure !== null && !key && !token && (
        <p role="alert" className="notice notice--error add-package__failure">
          {failure}
        </p>
      )}
      <footer className="add-package__foot">
        {back !== null && (
          <button type="button" className="button" disabled={sending} onClick={back}>
            ← {t.account.back}
          </button>
        )}
        <span className="add-package__spacer" />
        <button type="submit" className="button button--primary" disabled={!ready}>
          {token ? t.addAccount.sign.action : text.action}
        </button>
      </footer>
    </form>
  )
}
