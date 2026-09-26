import { Link } from 'react-router'
import { isOpen } from '../../../src/huly/model.js'
import type { BatonState } from '../../../src/state.js'
import { projectTasks } from '../state.js'

export function Home({ state }: { state: BatonState }) {
  return (
    <section className="page">
      <h1 className="page__title">Проекты</h1>
      {state.projects.length === 0 ? (
        <p className="placeholder">В baton.config.json нет проектов.</p>
      ) : (
        <ul className="plain-list">
          {state.projects.map((key) => (
            <li key={key}>
              <Link to={`/p/${key}`} className="row-link">
                <span className="row-link__key">{key}</span>
                <span className="row-link__meta">
                  {state.chain.active?.project === key && 'идёт цепочка · '}
                  открытых задач: {projectTasks(state, key).filter((task) => isOpen(task.status)).length}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
