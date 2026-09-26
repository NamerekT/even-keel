import { useEffect } from 'react'
import { useLocation, useParams } from 'react-router'
import type { BatonState } from '../../../src/state.js'
import { useCommand } from '../live/useCommand.js'
import { chainBlocks, chainStatus, queuedAfter } from '../state.js'
import { StatusChip } from '../ui/StatusChip.js'
import { ChainSnake } from './ChainSnake.js'
import { NotFound } from './NotFound.js'

export function Project({ state }: { state: BatonState }) {
  const key = useParams().key ?? ''
  const focus = decodeURIComponent(useLocation().hash.slice(1))
  useEffect(() => {
    if (focus !== '') document.getElementById(focus)?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  if (!state.projects.includes(key)) return <NotFound what={`Проекта ${key} нет в baton.config.json.`} />

  const order = state.chain.projects[key]
  const blocks = chainBlocks(state, key)

  return (
    <section className="page">
      <header className="project__head">
        <h1 className="page__title project__title">{key}</h1>
        <StatusChip status={chainStatus(state.chain, key)} />
        <ChainControls state={state} project={key} />
      </header>
      {order?.error && <p className="notice notice--error">{order.error}</p>}
      {blocks.length === 0 ? (
        <p className="placeholder">{order === undefined ? 'Задачи ещё не загружены.' : 'Задач в цепочке нет.'}</p>
      ) : (
        <ChainSnake blocks={blocks} scale={state.context} focus={focus} />
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
      onClick={() => void send(name, name === 'start' ? { project } : undefined)}
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
      {error !== null && <p className="project__error">{error}</p>}
    </div>
  )
}
