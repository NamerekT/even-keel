import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { isNarrow, useNarrow } from '../layout/useNarrow.js'
import { useWide } from '../layout/useWide.js'
import { useCommand } from '../live/useCommand.js'
import { shownWork } from '../work.js'
import {
  activeChain,
  backlogTasks,
  backlogWork,
  canUnready,
  chainBlocks,
  fixBlockOf,
  hasLiveSession,
  chainControls,
  chainStatus,
  ciWaitText,
  issueLink,
  limitWaitText,
  openQuestions,
  projectLabel,
  projectPages,
  projectSlot,
  projectTasks,
  questionPath,
  queuedAfter,
  readyButton,
  startsNow,
  taskLinks,
  taskProject,
  type ChainControl,
} from '../state.js'
import { focusAfterClose, focusOnEntry } from '../ui/focus.js'
import { RefreshIcon } from '../ui/icons.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import { QuestionsChip } from '../ui/QuestionsChip.js'
import { StatusChip } from '../ui/StatusChip.js'
import { Tipped } from '../ui/Tipped.js'
import { BACKLOG_HASH, BacklogChip, BacklogPanel } from './BacklogPanel.js'
import { ChainList } from './ChainList.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { CI_HASH, CiChip, CiPanel, ciFocus } from './CiChip.js'
import { Flight } from './Flight.js'
import { HELP_HASH, HelpChip, HelpPanel } from './HelpPanel.js'
import { IdlePanel } from './IdlePanel.js'
import { NotFound } from './NotFound.js'
import { emptyCall } from './ProjectCard.js'
import { ProjectName } from './ProjectName.js'
import { SessionPanel } from './SessionPanel.js'
import { SettingsChip, SettingsPanel, useSettingsDirty } from './SettingsPanel.js'
import { SETTINGS_HASH } from './settingsStore.js'
import { ProjectNotices } from './ProjectNotices.js'
import { NoticeFixButton } from './FixButtons.js'
import { PullFixButton } from './PullButtons.js'
import { StatsStrip, useStrip } from './StatsStrip.js'
import { ToolsLink } from './ToolsLink.js'
import { useArrival } from './useArrival.js'
import './project.css'

const TaskCard = lazy(async () => ({ default: (await import('./TaskCard.js')).TaskCard }))
const CARD_PARAM = 'task'

export function Project({ state, project: key }: { state: EvenKeelState; project: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const hash = decodeURIComponent(location.hash.slice(1))
  const close = useCallback(() => navigate({ search: location.search, hash: '' }), [navigate, location.search])
  const blocks = useMemo(() => chainBlocks(state, key), [state, key])
  const entered = useRef<string | null>(null)
  // Once per arrival, so the cross keeps the panel closed; not where the panel would cover the whole page.
  // A link to the fix of main by its name opens the row of its episode.
  const entry = fixBlockOf(blocks, hash) ?? (entered.current === key || isNarrow() ? null : focusOnEntry(blocks, hash))
  // Already the first frame shows the panel, the address catches up after it.
  const focus = entry ?? hash
  useEffect(() => {
    entered.current = key
    if (entry !== null) navigate({ search: location.search, hash: entry }, { replace: true })
  })
  const previous = useRef(blocks)
  useEffect(() => {
    const next = focusAfterClose(previous.current, blocks, focus)
    previous.current = blocks
    if (next !== null) navigate({ search: location.search, hash: next }, { replace: true })
  })
  useEffect(() => {
    if (focus !== '') document.getElementById(focus)?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  const arrival = useArrival(state, key, blocks, close)
  // The stats know a project by its key (Tally), not by its id.
  const statsKey = state.projectKeys[key] ?? key
  const strip = useStrip(statsKey, projectSlot(state, key))
  const wide = useWide()
  const narrow = useNarrow()
  const settings = state.config.projects[key]
  const settingsDirty = useSettingsDirty(key, settings)
  if (!state.projects.includes(key)) return <NotFound what={t.notFound.project(key)} />

  const order = state.chain.projects[key]
  const flight = arrival.flight
  const selected = blocks.find((block) => block.id === focus && !block.locked)
  const backlog = backlogTasks(state, key)
  const backlogWorks = backlogWork(state, key)
  const backlogOpen = focus === BACKLOG_HASH && backlog.length > 0
  const settingsOpen = focus === SETTINGS_HASH && settings !== undefined
  const ci = state.ci[key]
  const ciAt = ciFocus(focus)
  const ciOpen = ciAt.open && ci !== undefined
  const helpOpen = focus === HELP_HASH
  const side = selected !== undefined || backlogOpen || settingsOpen || ciOpen || helpOpen
  const column = side || wide
  // Over the side column the CI badge, Backlog, Settings and the help are tabs on its card; with no column they end the
  // head row, and on a narrow screen they are one block of segments at the end of the title row.
  const tabs = column && !narrow
  const look: ChipLook = tabs ? 'tab' : narrow ? 'seg' : 'tag'
  const toggle = (hash: string, open: boolean) => () => navigate({ search: location.search, hash: open ? '' : hash })
  const tools = (
    <>
      {ci !== undefined && <CiChip views={ci} open={ciOpen} look={look} onToggle={toggle(CI_HASH, ciOpen)} />}
      <BacklogChip
        count={backlog.length}
        open={backlogOpen}
        look={look}
        work={Object.keys(backlogWorks).length > 0}
        onToggle={toggle(BACKLOG_HASH, backlogOpen)}
      />
      {settings !== undefined && <SettingsChip open={settingsOpen} look={look} dirty={settingsDirty} onToggle={toggle(SETTINGS_HASH, settingsOpen)} />}
      <HelpChip open={helpOpen} look={look} onToggle={toggle(HELP_HASH, helpOpen)} />
    </>
  )
  const question = questionPath(state, [key])
  const tracker = state.trackers.find((view) => view.projects.includes(key))
  const links = taskLinks(state.tasks, state.sessions)
  const opened = new URLSearchParams(location.search).get(CARD_PARAM)
  const openCard = (task: string) => {
    const search = new URLSearchParams(location.search)
    search.set(CARD_PARAM, task)
    navigate({ search: search.toString(), hash: location.hash }, { state: { card: true }, replace: opened !== null })
  }
  const closeCard = () => {
    if ((location.state as { card?: boolean } | null)?.card === true) return void navigate(-1)
    const search = new URLSearchParams(location.search)
    search.delete(CARD_PARAM)
    navigate({ search: search.toString(), hash: location.hash }, { replace: true })
  }

  return (
    <section className={side ? 'project project--panel' : 'project'}>
      <div className="page">
        <header className="project__head">
          <h1 className="page__title project__title">{settings?.name == null ? projectLabel(state, key) : (state.projectKeys[key] ?? key)}</h1>
          {settings !== undefined && <ProjectName project={key} form={settings} />}
          <QuestionsChip count={openQuestions(projectTasks(state, key))} to={question?.includes('#') ? question : null} />
          {tracker !== undefined && <TrackerRead project={key} tracker={tracker} />}
          {narrow && <div className="hblock project__tools">{tools}</div>}
          <ChainControls state={state} project={key} narrow={narrow}>
            {look === 'tag' && tools}
          </ChainControls>
        </header>
        <ProjectNotices key={`notices-${key}`} state={state} project={key} rows={blocks.flatMap((block) => (block.leftovers === undefined ? [] : [block.id]))} />
        <EmptyCall state={state} project={key} />
        {blocks.length === 0 ? (
          emptyCall(state, key) === null && <p className="placeholder">{order === undefined ? t.project.chainNotLoaded : t.project.chainEmpty}</p>
        ) : (
          <ChainList
            key={key}
            project={key}
            chain={blocks}
            scale={state.context}
            trackerUrls={state.trackerUrls}
            focus={focus === BACKLOG_HASH || focus === SETTINGS_HASH || helpOpen || ciAt.open ? '' : focus}
            ghost={arrival.ghost}
            arrival={arrival.arrival}
            incoming={arrival.incoming}
            links={links}
            ready={(block) => readyButton(state, key, block)}
            unready={(block) => block.open && !block.locked && canUnready(state, key, block)}
            onCard={openCard}
          />
        )}
        <StatsStrip project={statsKey} strip={strip} />
        <ToolsLink key={`tools-${key}`} project={key} trim={state.trimTools} packages={state.packages} />
      </div>
      {column && (
        <div className={tabs ? 'project__side project__side--tabs' : 'project__side'}>
          {tabs && <div className="side-tabs">{tools}</div>}
          {selected !== undefined && (
            <SessionPanel key={selected.id} block={selected} scale={state.context} ci={ci !== undefined} onCard={openCard} onClose={close} />
          )}
          {backlogOpen && (
            <BacklogPanel
              tasks={backlog}
              works={backlogWorks}
              trackerUrls={state.trackerUrls}
              ready={(task) => readyButton(state, key, { id: task.id, stage: task.status.category, locked: false })}
              links={links}
              onCard={openCard}
              onClose={close}
              onPoint={arrival.point}
              leaving={arrival.leaving}
              onMove={(task) => arrival.move(task.id, task.title)}
              onSettled={arrival.settle}
            />
          )}
          {settingsOpen && <SettingsPanel key={`settings-${key}`} project={key} form={settings} config={state.config} configError={state.configError} tasks={projectTasks(state, key)} onClose={close} />}
          {ciOpen && <CiPanel views={ci} urls={state.trackerUrls} fixes={state.fixes[key] ?? []} fix={ciAt.fix} onClose={close} />}
          {helpOpen && <HelpPanel blocks={blocks} ci={ci !== undefined} narrow={narrow} onClose={close} />}
          {!side && (
            <IdlePanel
              key={key}
              scene={{
                loaded: order !== undefined && order.error === null,
                blocks,
                backlog: backlog.length,
                status: chainStatus(state.chain, key),
                unattended: state.unattended,
                monthCost: strip.summary?.cost ?? null,
              }}
            />
          )}
        </div>
      )}
      {flight !== null && (
        <Flight key={flight.id} task={flight.id} title={flight.title} since={flight.since} onLand={() => arrival.land(flight.id)} />
      )}
      {opened !== null && (
        <Suspense fallback={null}>
          <TaskCard
            task={opened}
            link={issueLink(state.trackerUrls, opened)}
            tracker={state.trackers.find((view) => view.projects.includes(taskProject(state, opened)))?.title ?? null}
            refused={state.chain.projects[taskProject(state, opened)]?.refused?.[opened] ?? null}
            work={shownWork(state, taskProject(state, opened), opened)}
            live={hasLiveSession(state, opened)}
            onOpen={openCard}
            onClose={closeCard}
          />
        </Suspense>
      )}
    </section>
  )
}

/** The tracker is read every 30 seconds; the button reads it now, for a change made there a moment ago. */
function TrackerRead({ project, tracker }: { project: string; tracker: TrackerView }) {
  const { send, sending, failure } = useCommand()
  const now = useNow(5_000)
  const at = tracker.readAt[project]

  return (
    <span className="project__read">
      <button
        type="button"
        className="project__refresh"
        aria-label={t.project.refresh(tracker.title)}
        title={t.project.refresh(tracker.title)}
        disabled={sending}
        aria-busy={sending ? true : undefined}
        onClick={() => void send('chain/refresh', { project })}
      >
        <RefreshIcon />
      </button>
      {failure !== null ? (
        <span className="project__read-at project__read-at--failed">{say(failure)}</span>
      ) : (
        <span className="project__read-at">{at === undefined ? t.project.notRead : t.project.readAt(formatAgo(at, now))}</span>
      )}
    </span>
  )
}

/** A project with nothing to run says where the tasks come from and opens the project and its feeds in their trackers. */
function EmptyCall({ state, project }: { state: EvenKeelState; project: string }) {
  const call = emptyCall(state, project)
  if (call === null) return null
  return (
    <p className="project__call">
      {call}
      {projectPages(state, project).map((page) => (
        <a key={page.url} className="button button--small" href={page.url} target="_blank" rel="noreferrer">
          {t.project.openIn(page.tracker)}
        </a>
      ))}
    </p>
  )
}


/** On a narrow screen the two buttons are one block of segments, like the head's other blocks. */
function ChainControls({ state, project, narrow, children }: { state: EvenKeelState; project: string; narrow: boolean; children?: ReactNode }) {
  const { send, sending, failure } = useCommand()
  const status = chainStatus(state.chain, project)
  const controls = chainControls(status, state.chain.projects[project])
  const error = failure
  const after = queuedAfter(state.chain, project)
  const off = controls.off === null ? undefined : t.project.off[controls.off]

  const active = status.kind === 'running' || status.kind === 'paused'
  const base = narrow ? SEG_CLASS : 'button'
  const button = (label: ReactNode, name: ChainControl, onClick = () => void send(`chain/${name}`, { project })) => (
    <button
      type="button"
      className={controls.primary === name ? `${base} ${narrow ? 'seg-button--primary' : 'button--primary'}` : base}
      disabled={sending || !controls.enabled.includes(name)}
      title={controls.enabled.includes(name) ? undefined : off}
      onClick={onClick}
    >
      {label}
    </button>
  )

  // The buttons stay in place whatever the status, so a repeated click never lands on another one.
  const first = active ? button(t.project.resume, 'resume') : button(startsNow(state.chain) ? t.project.start : t.project.enqueue, 'start')
  const chain = activeChain(state.chain, project)
  const stopsAfter = chain?.stopAfter === true
  // A running chain stops once its session's turn ends, the session untouched; a paused one runs nothing, so it stops at once.
  const stop =
    status.kind === 'running'
      ? button(
          <Tipped tip={stopsAfter ? t.project.keepGoingTip : t.project.stopTip(chain?.current?.task ?? chain?.closing ?? null)} inline>
            {stopsAfter ? t.project.keepGoing : t.project.stop}
          </Tipped>,
          'stop',
          () => void send('chain/stopAfter', { project, on: !stopsAfter }),
        )
      : button(t.project.stop, 'stop')
  return (
    <>
      <div className="project__controls">
        <StatusChip status={status} />
        {after !== null && <span className="project__queue">{t.project.after(after)}</span>}
        {narrow ? (
          <div className="hblock project__buttons">
            {first}
            {stop}
          </div>
        ) : (
          <>
            {first}
            {stop}
          </>
        )}
        {children}
      </div>
      {status.kind === 'running' && status.limitUntil !== null && (
        <p className="project__wait">{limitWaitText(status.limitUntil, new Date())}</p>
      )}
      {status.kind === 'running' && status.slotWait !== undefined && (
        <p className="project__wait">
          <Said notice={status.slotWait} />
        </p>
      )}
      {status.kind === 'running' && status.ciWait !== undefined && (
        <p className="project__wait">
          <ProjectLinks text={ciWaitText(status.ciWait, new Date())} />
        </p>
      )}
      {stopsAfter && <p className="project__wait">{t.project.stopsAfter(chain?.current?.task ?? chain?.closing ?? null)}</p>}
      {error !== null && (
        <p className="project__error">
          <Said notice={error} />
        </p>
      )}
      <NoticeFixButton project={project} notice={error} />
      <PullFixButton state={state} project={project} error={error} />
    </>
  )
}
