import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { chainProgress, projectName, projectPath, projectSlot, projectTasks } from '../state.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { emptyCall, quipOf } from './ProjectCard.js'

/** A project with nothing to run, as one item of the strip under the cards; its name and its card's joke go into the tip. */
export function QuietRow({ state, project, turn }: { state: EvenKeelState; project: string; turn: number }) {
  const progress = chainProgress(projectTasks(state, project), state.chain.projects[project])
  const quip = quipOf(progress, turn)
  const name = projectName(state, project)
  const call = emptyCall(state, project)
  return (
    <Tipped
      className="quiet"
      align="start"
      inline
      tip={
        <>
          {name !== null && <strong className="quiet__tip-name">{name}</strong>}
          {quip === null ? (
            t.project.noTasks
          ) : (
            <>
              {quip.setup}
              {quip.punchline !== null && <> {quip.punchline}</>}
            </>
          )}
          {call !== null && <span className="quiet__tip-call">{call}</span>}
        </>
      }
    >
      <Link to={projectPath(state, project)} className="quiet__row" style={seriesStyle(projectSlot(state, project))}>
        <span className="card__swatch" aria-hidden="true" />
        <span className="quiet__key">{project}</span>
        <span className="quiet__count" aria-label={t.project.done}>
          <strong>{progress.done}</strong> / {progress.total}
        </span>
      </Link>
    </Tipped>
  )
}
