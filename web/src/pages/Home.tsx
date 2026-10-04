import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { LaunchChart } from './LaunchChart.js'
import { ProjectCard } from './ProjectCard.js'

export function Home({ state }: { state: EvenKeelState }) {
  return (
    <section className="page">
      <h1 className="page__title">{t.home.title}</h1>
      {state.projects.length === 0 ? (
        <p className="placeholder">{t.home.empty}</p>
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
