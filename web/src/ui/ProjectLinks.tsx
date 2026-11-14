import { Link, useMatch } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import { sayIds, sayLines, sentence } from '../i18n/index.js'
import { Tipped } from './Tipped.js'
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

/**
 * A server message in the page's language, its projects as links (`ProjectLinks`). A path the text shortens is whole in
 * its tip (BTN-1150); `plain` — without one, for a message that stands inside a tip already.
 */
export function Said({ notice, plain = false }: { notice: Notice; plain?: boolean }) {
  const paths = plain ? [] : fullPathsOf(notice)
  const text = <ProjectLinks text={sayIds(notice)} />
  return paths.length === 0 ? text : <Tipped tip={<PathLines paths={paths} />} inline>{text}</Tipped>
}

/**
 * A server message as an error band shows it (BTN-1149, `sayLines`): what happened, and smaller under it the causes and
 * the one thing to do; a message that is its text alone stays `Said`. A path the text shortens is whole in the line's tip.
 */
export function SaidLines({ notice }: { notice: Notice }) {
  const { head, under } = sayLines(notice)
  if (under === null) return <Said notice={notice} />
  const paths = fullPathsOf(notice)
  return (
    <>
      <strong className="said__head"><ProjectLinks text={sentence(head).replace(/\.$/, '')} /></strong>
      <Tipped tip={<PathLines paths={paths} />} off={paths.length === 0} inline className="said__under"><ProjectLinks text={under} /></Tipped>
    </>
  )
}

function PathLines({ paths }: { paths: string[] }) {
  return paths.map((path) => <span key={path}>{path}</span>)
}

/** The whole paths a message shortens (`shownUnder`): its own, its causes' and its items'. */
export function fullPathsOf(notice: Notice): string[] {
  const full = (notice.params as { full?: unknown }).full
  const under = [...(notice.cause === undefined ? [] : [notice.cause]), ...(notice.items ?? [])]
  return [...new Set([...(typeof full === 'string' ? [full] : []), ...under.flatMap(fullPathsOf)])]
}
