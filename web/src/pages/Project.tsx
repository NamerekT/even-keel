import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import type { BatonState } from '../../../src/state.js'
import { useCommand } from '../live/useCommand.js'
import { chainBlocks, chainStatus, limitWaitText, queuedAfter } from '../state.js'
import { StatusChip } from '../ui/StatusChip.js'
import { ChainSnake } from './ChainSnake.js'
import { NotFound } from './NotFound.js'
import { SessionPanel } from './SessionPanel.js'

export function Project({ state }: { state: BatonState }) {
  const key = useParams().key ?? ''
  const location = useLocation()
  const navigate = useNavigate()
  const focus = decodeURIComponent(location.hash.slice(1))
  const close = useCallback(() => navigate({ search: location.search, hash: '' }), [navigate, location.search])
  useEffect(() => {
    if (focus !== '') document.getElementById(focus)?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  if (!state.projects.includes(key)) return <NotFound what={`Проекта ${key} нет в baton.config.json.`} />

  const order = state.chain.projects[key]
  const blocks = chainBlocks(state, key)
  const selected = blocks.find((block) => block.id === focus)

  return (
    <section className={selected === undefined ? 'project' : 'project project--panel'}>
      <div className="page">
        <header className="project__head">
          <h1 className="page__title project__title">{key}</h1>
          <StatusChip status={chainStatus(state.chain, key)} />
          <ChainControls state={state} project={key} />
        </header>
        {order?.error && <p className="notice notice--error">{order.error}</p>}
        {blocks.length === 0 ? (
          <p className="placeholder">{order === undefined ? 'Задачи ещё не загружены.' : 'Задач в цепочке нет.'}</p>
        ) : (
          <ChainSnake key={key} project={key} chain={blocks} scale={state.context} focus={focus} />
        )}
      </div>
      {selected !== undefined && (
        <SessionPanel key={selected.id} block={selected} scale={state.context} trackerUrl={state.trackerUrl} onClose={close} />
      )}
    </section>
  )
}

function ChainControls({ state, project }: { state: BatonState; project: string }) {
  const { send, sending, failure } = useCommand()
  const status = chainStatus(state.chain, project)
  const order = state.chain.projects[project]
  const canStart = status.kind === 'idle' && order !== undefined && order.error === null && order.order.length > 0
  const error = (status.kind === 'paused' ? status.error : null) ?? failure
  const after = queuedAfter(state.chain, project)

  const button = (label: string, name: string, primary = false) => (
    <button
      type="button"
      className={primary ? 'button button--primary' : 'button'}
      disabled={sending}
      onClick={() => void send(`chain/${name}`, name === 'start' ? { project } : undefined)}
    >
      {label}
    </button>
  )

  return (
    <div className="project__controls">
      {canStart && button(state.chain.active === null ? 'Запустить' : 'В очередь', 'start', true)}
      {status.kind === 'running' && button('Пауза', 'pause')}
      {status.kind === 'paused' && button('Снять с паузы', 'resume', true)}
      {after !== null && <span className="project__queue">в очереди после {after}</span>}
      {status.kind === 'running' && status.limitUntil !== null && (
        <p className="project__wait">{limitWaitText(status.limitUntil, new Date())}</p>
      )}
      {error !== null && <p className="project__error">{error}</p>}
    </div>
  )
}
