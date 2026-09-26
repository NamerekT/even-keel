import type { BatonState } from '../../../src/state.js'
import { LaunchChart } from './LaunchChart.js'
import { ProjectCard } from './ProjectCard.js'

export function Home({ state }: { state: BatonState }) {
  return (
    <section className="page">
      <h1 className="page__title">Проекты</h1>
      {state.projects.length === 0 ? (
        <p className="placeholder">В baton.config.json нет проектов.</p>
      ) : (
        <div className="cards">
          {state.projects.map((key) => (
            <ProjectCard key={key} state={state} project={key} />
          ))}
        </div>
      )}
      <LaunchChart days={state.launches} projects={state.projects} />
    </section>
  )
}
