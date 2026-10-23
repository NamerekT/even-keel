import { Link, useMatch } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import { sayIds } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { projectLabel, projectOfPath, projectPath } from '../state.js'
import { piecesOf } from './projectPieces.js'
import './projectLinks.css'

/**
 * A text that names projects by their ids, each one a link to its project's page by its label (BTN-319). The project of
 * the page it stands on is only its label.
 */
export function ProjectLinks({ text }: { text: string }) {
  const { state } = useLive()
  const page = useMatch('/p/:id')?.params.id
  if (state === null) return text
  const here = page === undefined ? null : projectOfPath(state, page).project
  return piecesOf(text, state.projects).map((piece, index) =>
    typeof piece === 'string' ? (
      piece
    ) : piece.project === here ? (
      projectLabel(state, piece.project)
    ) : (
      <Link key={index} to={projectPath(piece.project)} className="project-link">
        {projectLabel(state, piece.project)}
      </Link>
    ),
  )
}

/** A server message in the page's language, its projects as links (`ProjectLinks`). */
export function Said({ notice }: { notice: Notice }) {
  return <ProjectLinks text={sayIds(notice)} />
}
