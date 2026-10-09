import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import {
  backlogTasks,
  canReady,
  chainBlocks,
  chainStatus,
  issueLink,
  limitWaitText,
  openQuestions,
  projectTasks,
  queuedAfter,
  startsNow,
  taskProject,
} from '../state.js'
import { focusAfterClose } from '../ui/focus.js'
import { QuestionsChip } from '../ui/QuestionsChip.js'
import { StatusChip } from '../ui/StatusChip.js'
import { BacklogList } from './BacklogList.js'
import { ChainList } from './ChainList.js'
import { NotFound } from './NotFound.js'
import { SessionPanel } from './SessionPanel.js'
import { StatsStrip } from './StatsStrip.js'
import { ToolsLink } from './ToolsLink.js'

const TaskCard = lazy(async () => ({ default: (await import('./TaskCard.js')).TaskCard }))
const CARD_PARAM = 'task'

export function Project({ state }: { state: EvenKeelState }) {
  const key = useParams().key ?? ''
  const location = useLocation()
  const navigate = useNavigate()
  const focus = decodeURIComponent(location.hash.slice(1))
  const close = useCallback(() => navigate({ search: location.search, hash: '' }), [navigate, location.search])
  const blocks = chainBlocks(state, key)
  const previous = useRef(blocks)
  useEffect(() => {
    const next = focusAfterClose(previous.current, blocks, focus)
    previous.current = blocks
    if (next !== null) navigate({ search: location.search, hash: next }, { replace: true })
  })
  useEffect(() => {
    if (focus !== '') document.getElementById(focus)?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  if (!state.projects.includes(key)) return <NotFound what={t.notFound.project(key)} />

  const order = state.chain.projects[key]
  const selected = blocks.find((block) => block.id === focus && !block.locked)
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
    <section className={selected === undefined ? 'project' : 'project project--panel'}>
      <div className="page">
        <header className="project__head">
          <h1 className="page__title project__title">{key}</h1>
          <StatusChip status={chainStatus(state.chain, key)} />
          <QuestionsChip count={openQuestions(projectTasks(state, key))} />
          <ChainControls state={state} project={key} />
        </header>
        {order?.error && <p className="notice notice--error">{say(order.error)}</p>}
        <Leftovers state={state} project={key} />
        {blocks.length === 0 ? (
          <p className="placeholder">{order === undefined ? t.project.chainNotLoaded : t.project.chainEmpty}</p>
        ) : (
          <ChainList
            key={key}
            project={key}
            chain={blocks}
            scale={state.context}
            trackerUrls={state.trackerUrls}
            focus={focus}
            onCard={openCard}
          />
        )}
        <BacklogList tasks={backlogTasks(state, key)} trackerUrls={state.trackerUrls} canReady={canReady(state, key)} onCard={openCard} />
        <StatsStrip key={`stats-${key}`} project={key} />
        <ToolsLink key={`tools-${key}`} project={key} trim={state.trimTools} />
      </div>
      {selected !== undefined && (
        <SessionPanel key={selected.id} block={selected} scale={state.context} onCard={openCard} onClose={close} />
      )}
      {opened !== null && (
        <Suspense fallback={null}>
          <TaskCard
            task={opened}
            link={issueLink(state.trackerUrls, opened)}
            tracker={state.trackers.find((view) => view.projects.includes(taskProject(opened)))?.title ?? null}
            onOpen={openCard}
            onClose={closeCard}
          />
        </Suspense>
      )}
    </section>
  )
}

function Leftovers({ state, project }: { state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()
  const leftovers = state.chain.leftovers[project] ?? []
  if (leftovers.length === 0) return null
  const tasks = [...new Set(leftovers.map((each) => each.task))]

  return (
    <div className="leftovers">
      {tasks.map((task) => (
        <div key={task} className="notice notice--warn leftovers__item">
          <div className="leftovers__text">
            <strong>{t.project.leftover(task)}</strong>
            {leftovers
              .filter((each) => each.task === task)
              .map((each, index) => (
                <p key={index} className="leftovers__line">
                  {say(each.notice)}
                </p>
              ))}
          </div>
          <button type="button" className="button" disabled={sending} onClick={() => void send('chain/dismiss', { project, task })}>
            {t.project.dismiss}
          </button>
        </div>
      ))}
      {failure !== null && <p className="project__error">{say(failure)}</p>}
    </div>
  )
}

function ChainControls({ state, project }: { state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()
  const status = chainStatus(state.chain, project)
  const order = state.chain.projects[project]
  const canStart = status.kind === 'idle' && order !== undefined && order.error === null && order.order.length > 0
  const error = (status.kind === 'paused' ? status.error : null) ?? failure
  const after = queuedAfter(state.chain, project)

  const active = status.kind === 'running' || status.kind === 'paused'
  const button = (label: string, name: string, enabled: boolean, primary = false) => (
    <button
      type="button"
      className={primary ? 'button button--primary' : 'button'}
      disabled={sending || !enabled}
      onClick={() => void send(`chain/${name}`, { project })}
    >
      {label}
    </button>
  )

  // Both buttons stay in place whatever the status, so a repeated click never lands on the other one.
  return (
    <>
      <div className="project__controls">
        {after !== null && <span className="project__queue">{t.project.after(after)}</span>}
        {active
          ? button(t.project.resume, 'resume', status.kind === 'paused', true)
          : button(startsNow(state.chain) ? t.project.start : t.project.enqueue, 'start', canStart, true)}
        {button(t.project.stop, 'stop', active)}
      </div>
      {status.kind === 'running' && status.limitUntil !== null && (
        <p className="project__wait">{limitWaitText(status.limitUntil, new Date())}</p>
      )}
      {error !== null && <p className="project__error">{say(error)}</p>}
    </>
  )
}
