import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { EvenKeelState, MachinePage as MachinePageView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { checkText } from '../layout/MachineJoined.js'
import { Limits } from '../layout/Limits.js'
import { useOpenAdd } from '../layout/AddAccountDialog.js'
import { SessionsOnly } from '../layout/MachineSignIns.js'
import { MachineTokenDialog, type MachineTokenTarget } from '../layout/MachineTokenDialog.js'
import { useNow } from '../layout/useNow.js'
import { usePaintMachineStrip } from '../layout/MachineFilter.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { accountColors, nearAccountColor } from '../machineColor.js'
import { hubGapsOn, machineAccountsEmpty, machineAgents, machineChecks, osLabel } from '../machineAdd.js'
import { machineLogin } from '../machineSignIn.js'
import { SignIn } from './MachineAccountsPage.js'
import { projectPath } from '../state.js'
import { packagesPath } from '../tools/packageGroups.js'
import { AccountTag } from '../ui/AccountTag.js'
import { Band, Card, CommandBlock, EmptyState, Fact, FactList, PageHead } from '../ui/blocks.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { Lamp } from '../ui/Lamp.js'
import { Loading } from '../ui/Loader.js'
import { MoreMenu } from '../ui/MoreMenu.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { Tipped } from '../ui/Tipped.js'
import { IdentityButton } from './IdentityDialog.js'
import { HelpTip } from './settingsParts.js'
import { TakeOverButton } from './TakeOverButton.js'
import './settings.css'
import './machinePage.css'

/** Sessions and limits change without a `machines` event: the page reads itself again this often. */
const REREAD_MS = 15_000
const CLOCK_MS = 30_000
const PICK_REST_MS = 400
const WINDOWS_DIFFER = { code: 'usage.tokenWindowsDiffer', params: {} } as const

/** A commit by its first seven characters, as git shows it; a version stays whole. */
const shortRef = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref)

/** The image's tag of the hub's version in the Compose folder's `.env`, then the pull or the rebuild of an own image. */
function ContainerSteps({ version }: { version: string }) {
  const text = t.machinePage
  return (
    <span className="machine-page__steps">
      <span className="machine-page__step">{text.containerEnv}</span>
      <CommandBlock command={`EVEN_KEEL_IMAGE_TAG=${version.replace(/^v/, '')}`} />
      <span className="machine-page__step">{text.containerPull}</span>
      <CommandBlock command="docker compose pull && docker compose up -d" />
      <span className="machine-page__step">{text.containerBuild}</span>
      <CommandBlock command="docker compose build --pull && docker compose up -d" />
    </span>
  )
}

/**
 * The machine's page, read again at each `machines` event, every `REREAD_MS` and at `reload`, whose promise ends
 * once that read has landed; `null` while read, `false` — none.
 */
function useMachinePage(machine: string): { page: MachinePageView | null | false; reload: () => Promise<void> } {
  const { read, onMachines } = useLive()
  const [page, setPage] = useState<MachinePageView | null | false>(null)
  const loader = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let live = true
    const load = () =>
      read<MachinePageView>('machines/view', { machine }).then(
        (next) => void (live && setPage(next)),
        () => void (live && setPage(false)),
      )
    loader.current = load
    void load()
    const off = onMachines(() => void load())
    const timer = setInterval(() => void load(), REREAD_MS)
    return () => {
      live = false
      off()
      clearInterval(timer)
    }
  }, [machine])
  const reload = useCallback(() => loader.current(), [])
  return { page, reload }
}

/** `/machines/<id>` (BTN-1272): one machine of the hub, the own one or one elsewhere — its report, settings, pool and work. */
export function MachinePage({ state }: { state: EvenKeelState }) {
  const { id = '' } = useParams()
  const { page, reload } = useMachinePage(id)
  return (
    <div className="page machine-page">
      <Loading busy={page === null} label={t.machinePage.reading} fit="block">
        {page === false && (
          <EmptyState className="machine-page__gone" action={<Link to="/" className="button">{t.machinePage.home}</Link>}>{t.machinePage.gone}</EmptyState>
        )}
        {page !== null && page !== false && <MachineView state={state} page={page} reload={reload} />}
      </Loading>
    </div>
  )
}

function MachineView({ state, page, reload }: { state: EvenKeelState; page: MachinePageView; reload: () => Promise<void> }) {
  const now = useNow(CLOCK_MS)
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const [revoking, setRevoking] = useState(false)
  // A colour being applied, shown before the server's answer (BTN-1515); null — the saved one.
  const [painting, setPainting] = useState<string | null>(null)
  const shown = painting ?? page.color
  usePaintMachineStrip(shown)
  const text = t.machinePage
  const revoke = async () => {
    if (await send('machines/revoke', { machine: page.id })) navigate('/')
  }
  const more = page.own ? [] : [{ label: text.revoke, danger: true, pick: () => setRevoking(true) }]
  const otherVersion = page.about !== null && page.about.evenKeel !== page.hubVersion
  // Docker replaces a machine in a container: the page gives the Compose commands, never an update in place (BTN-1440).
  const boxed = page.about?.container === true
  return (
    <div className="machine-page__body">
      <PageHead
        className="machine-page__head"
        title={<span className="machine-page__title" style={{ '--machine': shown } as CSSProperties}>{page.name}</span>}
        actions={more.length > 0 ? <MoreMenu items={more} label={text.more} /> : undefined}
      >
        <span className={`chip machine-page__state${page.online ? ' machine-page__state--online' : ''}`}>{page.online ? text.online : text.offline}</span>
        {page.own && <span className="tag">{text.own}</span>}
      </PageHead>
      {!page.own && otherVersion && page.about !== null && (
        <Band tone="warn" className="machine-page__version">
          <span>{text.otherVersion(page.about.evenKeel, page.hubVersion)}</span>
          {boxed ? <ContainerSteps version={page.hubVersion} /> : <CommandBlock command={`even-keel update ${page.hubVersion}`} />}
        </Band>
      )}
      {!page.own && page.about?.follow !== undefined && !(boxed && otherVersion) && (
        boxed ? (
          <Band tone="warn" className="machine-page__version">
            <span>{text.followContainer(page.about.follow.to)}</span>
            <ContainerSteps version={page.about.follow.to} />
          </Band>
        ) : (
          <Band tone="warn">{text.follow[page.about.follow.stuck](shortRef(page.about.follow.to))}</Band>
        )
      )}
      {page.taken.map((each) => (
        <Band key={each.project} tone="warn" action={<TakeOverButton project={each.project} owner={each.machine} name={each.name} machine={page.id} className="button button--small" />}>
          <span><ProjectLabel project={each.project} /> — {text.taken(each.name)}</span>
        </Band>
      ))}
      <div className="machine-page__grid">
        <div className="machine-page__column">
          <SettingsCard page={page} reload={reload} show={setPainting} />
          <ReportCard state={state} page={page} now={now} reload={reload} />
        </div>
        <div className="machine-page__column">
          <ProjectsCard page={page} />
          <AccountsCard state={state} page={page} now={now} />
          <SessionsCard page={page} />
        </div>
      </div>
      {revoking && (
        <ConfirmDialog
          title={text.revokeTitle(page.name)}
          question={text.revokeQuestion}
          confirm={text.revoke}
          cancel={text.cancel}
          busy={sending}
          failure={failure === null ? undefined : say(failure)}
          onConfirm={() => void revoke()}
          onClose={() => setRevoking(false)}
        />
      )}
    </div>
  )
}

/**
 * The capacity and the colour: the capacity saved by its button, a colour applied at a click. The colour is `show`n
 * at once — at a click, at each step of the picker's drag — and dropped once the page read after the answer has
 * landed, or back to the saved one when the server refuses.
 */
function SettingsCard({ page, reload, show }: { page: MachinePageView; reload: () => Promise<void>; show: (color: string | null) => void }) {
  const text = t.machinePage
  const { send, sending, failure } = useCommand()
  const [capacity, setCapacity] = useState(String(page.capacity))
  useEffect(() => setCapacity(String(page.capacity)), [page.capacity])
  const value = Number(capacity)
  const valid = /^\d+$/.test(capacity.trim()) && value >= 1
  const changed = valid && value !== page.capacity
  // The picker's colour as dragged: sent once it rests, not at each step of the drag.
  const [drawn, setDrawn] = useState(page.color)
  useEffect(() => setDrawn(page.color), [page.color])
  useEffect(() => {
    if (drawn === page.color) return
    const timer = setTimeout(() => void paint(drawn, drawn), PICK_REST_MS)
    return () => clearTimeout(timer)
  }, [drawn])
  const near = useMemo(() => nearAccountColor(drawn, accountColors()), [drawn])
  // Each colour asked for, so an answer to an older one never drops a newer one shown.
  const attempt = useRef(0)
  const save = async () => {
    if (await send('machines/capacity', { machine: page.id, capacity: value })) void reload()
  }
  const paint = async (color: string | null, seen: string) => {
    const mine = ++attempt.current
    const saved = page.color
    show(seen)
    const done = await send('machines/color', { machine: page.id, color })
    if (done) await reload()
    if (attempt.current !== mine) return
    show(null)
    if (!done) setDrawn(saved)
  }
  const drag = (color: string) => {
    attempt.current++
    setDrawn(color)
    show(color === page.color ? null : color)
  }
  return (
    <Card title={text.settings} titleId="machine-settings">
      <div className="machine-page__field">
        <span className="machine-page__label">
          <label htmlFor="machine-capacity">{page.own ? text.capacityOwn : text.capacity}</label>
          <HelpTip text={page.own ? text.capacityOwnHint : text.capacityHint} />
        </span>
        <span className="machine-page__capacity">
          <input
            id="machine-capacity"
            className="settings__text machine-page__number"
            autoComplete="off"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={capacity}
            aria-invalid={!valid}
            onChange={(event) => setCapacity(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && changed) void save()
            }}
          />
          <button type="button" className="button button--small button--primary" disabled={!changed || sending} onClick={() => void save()}>
            {text.save}
          </button>
        </span>
        {!valid && <span className="settings__error machine-page__wide">{text.capacityBad}</span>}
      </div>
      <div className="machine-page__field">
        <span className="machine-page__label">
          <label htmlFor="machine-color">{text.color}</label>
          <HelpTip text={text.colorHint} />
        </span>
        <span className="machine-page__colors">
          {page.palette.map((color) => (
            <button
              key={color}
              type="button"
              className="machine-page__swatch"
              style={{ background: color }}
              aria-label={text.swatch(color)}
              aria-pressed={page.picked && page.color === color}
              disabled={sending}
              onClick={() => void paint(color, color)}
            />
          ))}
          <Tipped tip={text.colorOwn} inline>
            <input
              id="machine-color"
              className="machine-page__picker"
              type="color"
              value={drawn}
              aria-label={text.colorOwn}
              disabled={sending}
              onChange={(event) => drag(event.target.value)}
            />
          </Tipped>
          {page.picked && (
            <Tipped tip={text.colorPaletteHint} inline>
              <button type="button" className="button button--small" disabled={sending} onClick={() => void paint(null, page.paletteColor)}>
                {text.colorPalette}
              </button>
            </Tipped>
          )}
        </span>
        {near && <p className="machine-page__note machine-page__wide">{text.colorNear}</p>}
      </div>
      {failure !== null && (
        <p role="alert" className="notice notice--error">
          {say(failure)}
        </p>
      )}
    </Card>
  )
}

/**
 * What the machine reported, a fact each: its system, Even Keel, when it joined, Node, git with its name and e-mail,
 * the agents' CLIs as tags, and its folder of projects. What follows from a failed check is the tip of its value.
 * Under them, git's name and e-mail set there by the setup's dialog (BTN-1503), while the machine is on the link.
 */
function ReportCard({ state, page, now, reload }: { state: EvenKeelState; page: MachinePageView; now: Date; reload: () => void }) {
  const text = t.machinePage
  const about = page.about
  if (about === null) {
    return (
      <Card title={text.report} titleId="machine-report">
        <p className="machine-page__empty">{text.reportNone}</p>
      </Card>
    )
  }
  const node = checkText(machineChecks(about, [])[0]!)
  const { found, lacking } = machineAgents(about, page.missing, state.account.accounts.map((entry) => entry.agent))
  // A machine older than the git name and e-mail of its report (BTN-1307) says only that both are set.
  const userOnly = about.gitUser && about.gitName === undefined && about.gitEmail === undefined
  const facts = [
    <Fact key="system" label={text.system}>
      <dd>{osLabel(about.os)}</dd>
      <dd className="machine-page__muted">{about.host}</dd>
    </Fact>,
    <Fact key="even-keel" label={text.evenKeel}>
      <dd>{about.evenKeel}</dd>
      {about.commit !== undefined && <dd className="machine-page__muted">{shortRef(about.commit)}</dd>}
    </Fact>,
    page.joinedAt !== null && !page.own && (
      <Fact key="joined" label={text.joined}>
        <dd>{formatAgo(new Date(page.joinedAt).toISOString(), now)}</dd>
      </Fact>
    ),
    <ValueFact key="node" label={text.node} value={about.node} effect={node.effect} />,
    <ValueFact key="git" label={text.git} value={about.git ?? t.machines.gitMissing} effect={about.git === null ? t.machines.gitMissingEffect : undefined} />,
    ...(about.git === null
      ? []
      : userOnly
        ? [<ValueFact key="git-user" label={text.gitUser} value={t.machines.gitUser} />]
        : [
            <ValueFact key="git-name" label={text.gitName} value={about.gitName ?? text.gitUnset} effect={about.gitName === undefined ? text.gitUnsetTip : undefined} />,
            <ValueFact key="git-email" label={text.gitEmail} value={about.gitEmail ?? text.gitUnset} effect={about.gitEmail === undefined ? text.gitUnsetTip : undefined} />,
          ]),
  ].filter((fact) => fact !== false)
  // The agents fill the rest of their row, so the folder below starts a row of its own with no hole before it.
  const rest = 3 - (facts.length % 3)
  return (
    <Card title={text.report} titleId="machine-report">
      <FactList>
        {facts}
        <Fact label={text.agents} tone={lacking.length > 0 ? 'warn' : 'ok'} className={`machine-page__fill machine-page__fill--${rest}`}>
          <dd className="machine-page__tags">
            {found.length === 0 && lacking.length === 0 && <span className="machine-page__muted">{text.agentsNone}</span>}
            {found.map(({ agent, version }) => (
              <span key={agent} className="tag">{`${agentName(agent)} ${version}`}</span>
            ))}
            {lacking.map((agent) => (
              <Tipped key={agent} tip={text.noCliTip(agentName(agent))} inline>
                <span className="chip chip--paused">{text.noCli(agentName(agent))}</span>
              </Tipped>
            ))}
          </dd>
        </Fact>
        {/* The own machine's projects are where each project's settings put them: it has no folder of projects. */}
        {!(page.own && about.root === null) && (
          <Fact label={text.root} tone={about.root === null ? 'warn' : 'ok'} wide>
            <dd>{about.root === null ? text.rootNone : <bdi className="machine-page__path" dir="ltr">{about.root}</bdi>}</dd>
          </Fact>
        )}
      </FactList>
      {about.git !== null && page.online && (
        <div className="machine-page__report-actions">
          <IdentityButton
            className="button button--small"
            label={about.gitUser ? text.gitChange : text.gitSet}
            machine={{ id: page.id, name: page.name, gitName: about.gitName, gitEmail: about.gitEmail }}
            onSaved={reload}
          />
        </div>
      )}
    </Card>
  )
}

const agentName = (agent: string): string => t.account.agents[agent as keyof typeof t.account.agents] ?? agent

/** A fact of one value, framed as a warning when something follows from it: that is the value's tip. */
function ValueFact({ label, value, effect }: { label: string; value: string; effect?: string | undefined }) {
  return (
    <Fact label={label} tone={effect === undefined ? 'ok' : 'warn'}>
      <dd className="machine-page__value">
        {effect === undefined ? value : (
          <Tipped tip={effect} inline align="start">
            <span>{value}</span>
          </Tipped>
        )}
      </dd>
    </Fact>
  )
}

/** The projects whose pool has the machine: the folder there, whether it takes tasks, whether its packages are ready. */
function ProjectsCard({ page }: { page: MachinePageView }) {
  const text = t.machinePage
  return (
    <Card title={text.projects} titleId="machine-projects">
      {page.projects.length === 0 ? (
        <EmptyState action={<Link to="/" className="button button--small">{text.projectsOpen}</Link>}>{text.projectsNone}</EmptyState>
      ) : (
        <ul className="machine-page__list">
          {page.projects.map((each) => (
            <li key={each.project} className="machine-page__row">
              <span className="machine-page__main">
                <Link to={projectPath(each.project)} className="machine-page__name">
                  <ProjectLabel project={each.project} />
                </Link>
                <Tipped tip={text.folderTip} inline align="start">
                  <bdi className="machine-page__path" dir="ltr">
                    {each.folder}
                  </bdi>
                </Tipped>
              </span>
              {!each.enabled && <span className="tag machine-page__off">{text.disabled}</span>}
              {each.packagesBlocked && (
                <Tipped tip={each.packagesPause === null ? text.packagesBlocked : say(each.packagesPause)} inline align="end">
                  <span className="chip chip--paused">{text.packagesNotReady}</span>
                </Tipped>
              )}
              {each.packagesBlocked && (
                <Link to={packagesPath(each.project)} className="button button--small">
                  {text.packagesOpen}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * The machine's accounts, signed in there or not, with the limits it read; on a machine elsewhere then the hub's
 * subscriptions it is not signed in to, each with "Sign in" there, as its accounts page has them (BTN-1302).
 */
function AccountsCard({ state, page, now }: { state: EvenKeelState; page: MachinePageView; now: Date }) {
  const text = t.machinePage
  const view = t.machinePanel.view
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const signIns = state.machineSignIns
  const machine = signIns?.find((each) => each.machine === page.id)
  const gaps = page.own || machine === undefined ? [] : hubGapsOn(state.account.accounts, machine)
  const busy = sending || machineLogin(signIns) !== undefined
  const [token, setToken] = useState<MachineTokenTarget | null>(null)
  // A token whose windows differ from the poll (BTN-1267) is issued again for the hub's full sign-in of its e-mail.
  const newToken = (email: string | null) => {
    const hub = state.account.accounts.find((entry) => entry.agent === 'claude' && entry.longToken === undefined && email !== null && entry.status?.email === email)
    if (hub === undefined || page.own || !page.online) return null
    return (
      <button type="button" className="button button--small" disabled={busy} onClick={() => setToken({ machine: page.id, name: page.name, account: hub.key, who: email! })}>
        {t.account.newKey.longToken}
      </button>
    )
  }
  // A folder signed out is signed in again where it is: on a machine elsewhere through its sign-in window, here on `/accounts`.
  const signIn = (agent: string, account?: string) =>
    page.own ? (
      <Link to="/accounts" className="button button--small">
        {text.signIn}
      </Link>
    ) : (
      <SignIn
        name={page.name}
        online={page.online}
        busy={busy}
        noCli={page.missing.includes(agent) ? agentName(agent) : null}
        onClick={() => void send('machines/login', { machine: page.id, agent, ...(account !== undefined && { account }) })}
      />
    )
  const add = page.own ? (
    <Link to="/accounts" className="button button--small">
      {text.accountsOpen}
    </Link>
  ) : page.online ? (
    <button type="button" className="button button--small" disabled={busy || state.account.login !== null} onClick={() => openAdd(null)}>
      + {t.account.add}
    </button>
  ) : (
    <Tipped tip={view.addOffline(page.name)} align="start">
      <button type="button" className="button button--small" aria-disabled="true">
        + {t.account.add}
      </button>
    </Tipped>
  )
  const none = !page.own && machineAccountsEmpty(page.id, signIns) === 'waiting' ? view.accountsNone : view.accountsEmpty(page.name)
  return (
    <Card title={text.accounts} titleId="machine-accounts">
      {page.accounts.length === 0 && gaps.length === 0 ? (
        <EmptyState action={add}>{none}</EmptyState>
      ) : (
        <ul className="machine-page__list">
          {page.accounts.map((account) => (
            <li key={`${account.agent}:${account.key}`} className="machine-page__row machine-page__row--account">
              <span className="machine-page__main">
                <span className="machine-page__name">
                  {/* A machine elsewhere names its own folders: the hub knows the account by its e-mail. */}
                  <AccountTag account={page.own ? account.key : (account.email ?? account.key)} agent={account.agent} />
                  <span className={account.signedIn ? 'machine-page__muted' : 'machine-page__warn'}>{account.signedIn ? text.signedIn : text.signedOut}</span>
                  {account.longToken === true && <span className="tag">{text.longToken}</span>}
                </span>
                {account.signedIn && account.sessionsOnly === true && <span className="machine-page__note"><SessionsOnly email={account.email} send={send} sending={sending} /></span>}
                {account.signedIn && account.limitsDiffer === true && (
                  <span className="machine-page__note">
                    <Tipped className="machine-page__warn" tip={say(WINDOWS_DIFFER)} align="start" focusable>{text.limitsDiffer}</Tipped>
                    {newToken(account.email)}
                  </span>
                )}
              </span>
              {account.signedIn ? <Limits limits={account.limits} now={now} /> : signIn(account.agent, account.key)}
            </li>
          ))}
          {gaps.map(({ entry, gap }) => (
            <li key={`hub:${entry.key}`} className="machine-page__row machine-page__row--account">
              <span className="machine-page__main">
                <span className="machine-page__name">
                  <AccountTag account={entry.key} agent={entry.agent} />
                  <span className="machine-page__muted">{view.hubOnly}</span>
                </span>
              </span>
              {signIn(entry.agent, gap.account)}
            </li>
          ))}
        </ul>
      )}
      {failure !== null && (
        <p role="alert" className="notice notice--error">
          {say(failure)}
        </p>
      )}
      {token !== null && <MachineTokenDialog target={token} onClose={() => setToken(null)} />}
    </Card>
  )
}

/** The machine's sessions not finished: the lamp, the task, the agent and model as the model's tag. */
export function SessionsCard({ page }: { page: Pick<MachinePageView, 'sessions'> }) {
  const text = t.machinePage
  return (
    <Card title={text.sessions} titleId="machine-sessions">
      {page.sessions.length === 0 ? (
        <EmptyState action={<Link to="/" className="button button--small">{text.projectsOpen}</Link>}>{text.sessionsNone}</EmptyState>
      ) : (
        <ul className="machine-page__list">
          {page.sessions.map((session) => (
            <li key={session.sessionId} className="machine-page__row">
              <Lamp lamp={session.lamp === 'finished' ? 'done' : session.lamp} />
              <span className="machine-page__main">
                <span className="machine-page__name">{session.task ?? session.sessionId}</span>
                <bdi className="machine-page__path" dir="ltr">
                  {session.cwd}
                </bdi>
              </span>
              <RunLabelTag run={{ provider: session.agent, model: session.model == null || session.model === '' ? null : session.model, effort: null }} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
