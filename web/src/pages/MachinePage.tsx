import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { EvenKeelState, MachinePage as MachinePageView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { checkText } from '../layout/MachineJoined.js'
import { Limits } from '../layout/Limits.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { accountColors, nearAccountColor } from '../machineColor.js'
import { machineChecks, osLabel, type MachineCheck } from '../machineAdd.js'
import { projectPath } from '../state.js'
import { packagesPath } from '../tools/packageGroups.js'
import { AccountTag } from '../ui/AccountTag.js'
import { Band, Card, CommandBlock, EmptyState, Fact, FactList, PageHead } from '../ui/blocks.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { Lamp } from '../ui/Lamp.js'
import { Loading } from '../ui/Loader.js'
import { MoreMenu } from '../ui/MoreMenu.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { HelpTip } from './settingsParts.js'
import { TakeOverButton } from './TakeOverButton.js'
import './settings.css'
import './machinePage.css'

/** Sessions and limits change without a `machines` event: the page reads itself again this often. */
const REREAD_MS = 15_000
const CLOCK_MS = 30_000
const PICK_REST_MS = 400

/** A commit by its first seven characters, as git shows it; a version stays whole. */
const shortRef = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref)

/** The machine's page, read again at each `machines` event, every `REREAD_MS` and after `reload`; `null` while read, `false` — none. */
function useMachinePage(machine: string): { page: MachinePageView | null | false; reload: () => void } {
  const { read, onMachines } = useLive()
  const [page, setPage] = useState<MachinePageView | null | false>(null)
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    let live = true
    const load = () => void read<MachinePageView>('machines/view', { machine }).then((next) => live && setPage(next), () => live && setPage(false))
    load()
    const off = onMachines(load)
    const timer = setInterval(load, REREAD_MS)
    return () => {
      live = false
      off()
      clearInterval(timer)
    }
  }, [machine, asked])
  return { page, reload: () => setAsked((count) => count + 1) }
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

function MachineView({ state, page, reload }: { state: EvenKeelState; page: MachinePageView; reload: () => void }) {
  const now = useNow(CLOCK_MS)
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const [revoking, setRevoking] = useState(false)
  const text = t.machinePage
  const revoke = async () => {
    if (await send('machines/revoke', { machine: page.id })) navigate('/')
  }
  const more = page.own ? [] : [{ label: text.revoke, danger: true, pick: () => setRevoking(true) }]
  return (
    <div className="machine-page__body">
      <PageHead title={page.name} actions={more.length > 0 ? <MoreMenu items={more} label={text.more} /> : undefined}>
        <span className="machine-page__head">
          <span className="machine-page__mark" style={{ background: page.color }} aria-hidden="true" />
          <span className={`machine-page__state${page.online ? ' machine-page__state--online' : ''}`}>{page.online ? text.online : text.offline}</span>
          {page.own && <span className="tag">{text.own}</span>}
          {page.about !== null && (
            <span className="machine-page__muted">{page.about.commit === undefined ? text.version(page.about.evenKeel) : text.versionAt(page.about.evenKeel, shortRef(page.about.commit))}</span>
          )}
          {page.joinedAt !== null && !page.own && <span className="machine-page__muted">{text.joined(formatAgo(new Date(page.joinedAt).toISOString(), now))}</span>}
        </span>
      </PageHead>
      {!page.own && page.about !== null && page.about.evenKeel !== page.hubVersion && (
        <Band tone="warn" className="machine-page__version">
          <span>{text.otherVersion(page.about.evenKeel, page.hubVersion)}</span>
          <CommandBlock command={`even-keel update ${page.hubVersion}`} />
        </Band>
      )}
      {!page.own && page.about?.follow !== undefined && (
        <Band tone="warn">{text.follow[page.about.follow.stuck](shortRef(page.about.follow.to))}</Band>
      )}
      {page.taken.map((each) => (
        <Band key={each.project} tone="warn" action={<TakeOverButton project={each.project} owner={each.machine} name={each.name} machine={page.id} className="button button--small" />}>
          <span><ProjectLabel project={each.project} /> — {text.taken(each.name)}</span>
        </Band>
      ))}
      <div className="machine-page__grid">
        <div className="machine-page__column">
          <SettingsCard page={page} reload={reload} />
          <ReportCard state={state} page={page} />
        </div>
        <div className="machine-page__column">
          <ProjectsCard page={page} />
          <AccountsCard page={page} now={now} />
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

/** The capacity and the colour: the capacity saved by its button, a colour applied at a click. */
function SettingsCard({ page, reload }: { page: MachinePageView; reload: () => void }) {
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
    const timer = setTimeout(() => void paint(drawn), PICK_REST_MS)
    return () => clearTimeout(timer)
  }, [drawn])
  const near = useMemo(() => nearAccountColor(drawn, accountColors()), [drawn])
  const save = async () => {
    if (await send('machines/capacity', { machine: page.id, capacity: value })) reload()
  }
  const paint = async (color: string | null) => {
    if (await send('machines/color', { machine: page.id, color })) reload()
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
          <button type="button" className="button button--primary" disabled={!changed || sending} onClick={() => void save()}>
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
              onClick={() => void paint(color)}
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
              onChange={(event) => setDrawn(event.target.value)}
            />
          </Tipped>
          {page.picked && (
            <Tipped tip={text.colorPaletteHint} inline>
              <button type="button" className="button button--small" disabled={sending} onClick={() => void paint(null)}>
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

/** What the machine reported: its system, Node, git and the agents' CLIs, and its folder of projects. */
function ReportCard({ state, page }: { state: EvenKeelState; page: MachinePageView }) {
  const text = t.machinePage
  const about = page.about
  if (about === null) {
    return (
      <Card title={text.report} titleId="machine-report">
        <p className="machine-page__empty">{text.reportNone}</p>
      </Card>
    )
  }
  const hubAgents = [...new Set(state.account.accounts.map((entry) => entry.agent))]
  const checks = machineChecks(about, hubAgents)
  const agents = checks.filter((check) => check.id !== 'node' && check.id !== 'git')
  return (
    <Card title={text.report} titleId="machine-report">
      <FactList>
        <Fact label={text.system}>
          <dd>{osLabel(about.os)}</dd>
          <dd className="machine-page__muted">{about.host}</dd>
        </Fact>
        {checks.filter((check) => check.id === 'node' || check.id === 'git').map((check) => (
          <CheckFact key={check.id} label={check.id === 'node' ? text.node : text.git} checks={[check]} />
        ))}
        <CheckFact label={text.agents} checks={agents} empty={text.agentsNone} />
        {/* The own machine's projects are where each project's settings put them: it has no folder of projects. */}
        {!(page.own && about.root === null) && (
          <Fact label={text.root} tone={about.root === null ? 'warn' : 'ok'} wide>
            <dd>{about.root === null ? text.rootNone : <bdi className="machine-page__path" dir="ltr">{about.root}</bdi>}</dd>
          </Fact>
        )}
      </FactList>
    </Card>
  )
}

/** A fact of checks, framed as a warning when one fails: each check's line, and what follows from a failed one. */
function CheckFact({ label, checks, empty }: { label: string; checks: MachineCheck[]; empty?: string }) {
  return (
    <Fact label={label} tone={checks.every((check) => check.ok) ? 'ok' : 'warn'}>
      {checks.length === 0 && <dd className="machine-page__muted">{empty}</dd>}
      {checks.map((check) => {
        const { text: line, effect } = checkText(check)
        return (
          <dd key={check.id}>
            {line}
            {effect !== undefined && <span className="machine-page__effect"> — {effect}</span>}
          </dd>
        )
      })}
    </Fact>
  )
}

/** The projects whose pool has the machine: the folder there, whether it takes tasks, whether its packages are ready. */
function ProjectsCard({ page }: { page: MachinePageView }) {
  const text = t.machinePage
  return (
    <Card title={text.projects} titleId="machine-projects">
      {page.projects.length === 0 ? (
        <EmptyState action={<Link to="/" className="button">{text.projectsOpen}</Link>}>{text.projectsNone}</EmptyState>
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
                {each.packagesBlocked && <span className="machine-page__warn">{each.packagesPause === null ? text.packagesBlocked : say(each.packagesPause)}</span>}
              </span>
              {!each.enabled && <span className="tag machine-page__off">{text.disabled}</span>}
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

/** The hub's accounts as the machine has them: signed in there or not, with the limits the machine read. */
function AccountsCard({ page, now }: { page: MachinePageView; now: Date }) {
  const text = t.machinePage
  const { send, sending, failure } = useCommand()
  // A folder signed out is signed in again where it is: on a machine elsewhere through its sign-in window, here on `/accounts`.
  const signIn = (account: MachinePageView['accounts'][number]) =>
    page.own ? (
      <Link to="/accounts" className="button button--small">
        {text.signIn}
      </Link>
    ) : (
      <button
        type="button"
        className="button button--small"
        disabled={sending || !page.online || page.missing.includes(account.agent)}
        onClick={() => void send('machines/login', { machine: page.id, agent: account.agent, account: account.key })}
      >
        {text.signIn}
      </button>
    )
  return (
    <Card title={text.accounts} titleId="machine-accounts">
      {page.accounts.length === 0 ? (
        <EmptyState action={<Link to="/accounts" className="button">{text.accountsOpen}</Link>}>{text.accountsNone}</EmptyState>
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
              </span>
              {account.signedIn ? <Limits limits={account.limits} now={now} /> : signIn(account)}
            </li>
          ))}
        </ul>
      )}
      {failure !== null && (
        <p role="alert" className="notice notice--error">
          {say(failure)}
        </p>
      )}
    </Card>
  )
}

/** The machine's sessions not finished: the lamp, the task, the agent and model. */
function SessionsCard({ page }: { page: MachinePageView }) {
  const text = t.machinePage
  return (
    <Card title={text.sessions} titleId="machine-sessions">
      {page.sessions.length === 0 ? (
        <EmptyState action={<Link to="/" className="button">{text.projectsOpen}</Link>}>{text.sessionsNone}</EmptyState>
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
              <span className="machine-page__muted">{[t.account.agents[session.agent as keyof typeof t.account.agents] ?? session.agent, session.model].filter((each) => each != null && each !== '').join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
