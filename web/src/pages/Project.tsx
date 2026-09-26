import { useEffect } from 'react'
import { useLocation, useParams } from 'react-router'
import type { BatonState } from '../../../src/state.js'
import { projectTasks } from '../state.js'
import { NotFound } from './NotFound.js'

export function Project({ state }: { state: BatonState }) {
  const key = useParams().key ?? ''
  const focus = decodeURIComponent(useLocation().hash.slice(1))
  useEffect(() => {
    if (focus !== '') document.getElementById(focus)?.scrollIntoView({ block: 'center' })
  }, [focus])
  if (!state.projects.includes(key)) return <NotFound what={`Проекта ${key} нет в baton.config.json.`} />

  const tasks = new Map(projectTasks(state, key).map((task) => [task.id, task]))
  const order = state.chain.projects[key]

  return (
    <section className="page">
      <h1 className="page__title">{key}</h1>
      {order?.error && <p className="notice notice--error">{order.error}</p>}
      {order === undefined || order.order.length === 0 ? (
        <p className="placeholder">Открытых задач нет.</p>
      ) : (
        <ol className="plain-list">
          {order.order.map((id) => (
            <li key={id} id={id} className={id === focus ? 'row row--focus' : 'row'}>
              <span className="row__key">{id}</span>
              <span className="row__title">{tasks.get(id)?.title}</span>
              <span className="row__meta">{tasks.get(id)?.status.name}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
