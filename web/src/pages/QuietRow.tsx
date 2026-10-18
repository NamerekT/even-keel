import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { chainProgress, projectPath, projectSlot, projectTasks } from '../state.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { quipOf } from './ProjectCard.js'

/** A project with nothing to run, as one line under the cards; its card's joke goes into the tip. */
export function QuietRow({ state, project, turn }: { state: EvenKeelState; project: string; turn: number }) {
  const progress = chainProgress(projectTasks(state, project), state.chain.projects[project])
  const quip = quipOf(progress, turn)
  return (
    <Tipped
      className="quiet"
      align="start"
      tip={
        quip === null ? (
          t.project.noTasks
        ) : (
          <>
            {quip.setup}
            {quip.punchline !== null && <> {quip.punchline}</>}
          </>
        )
      }
    >
      <span className="quiet__row" style={seriesStyle(projectSlot(state, project))}>
        <span className="card__swatch" aria-hidden="true" />
        <Link to={projectPath(state, project)} className="quiet__key">
          <ProjectLabel project={project} nameClass="quiet__name" />
        </Link>
        <span className="quiet__count" aria-label={t.project.done}>
          <strong>{progress.done}</strong> / {progress.total}
        </span>
      </span>
    </Tipped>
  )
}
