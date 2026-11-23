import { useState } from 'react'
import { repository } from '../../../package.json'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { cliLine, repositoryUrl, reportLinks } from './reportLinks.js'

function useReportLinks() {
  const { state } = useLive()
  if (state === null) return null
  return reportLinks({
    repository: repositoryUrl(repository.url),
    version: state.updates.current,
    cli: cliLine(state.cliCopies, state.config.shared.provider),
  })
}

type Links = NonNullable<ReturnType<typeof useReportLinks>>

/** The four forms out, a link each opening GitHub in a new tab; the arrow after the name keeps its own 8 px. */
function Outlinks({ links, className }: { links: Links; className: string }) {
  const rows = [
    [links.bug, t.report.bug],
    [links.cliUpdate, t.report.cliUpdate],
    [links.setup, t.report.setup],
    [links.discussions, t.report.question],
  ] as const
  return rows.map(([href, name]) => (
    <a key={href} className={className} href={href} target="_blank" rel="noreferrer" title={t.report.external}>
      <span className="report__name">{name}</span>
      <span className="report__out" aria-hidden="true">
        ↗
      </span>
    </a>
  ))
}

function Private({ links }: { links: Links }) {
  return (
    <p className="report__private">
      {t.report.vulnerability}{' '}
      <a href={links.security} target="_blank" rel="noreferrer" title={t.report.external}>
        {t.report.privately}
      </a>
    </p>
  )
}

/**
 * The gear's "Report a problem" (BTN-1494): a hover or a press opens its list to the left of the menu, its top at the
 * row's — the gear stands at the right edge, with no room on that side.
 */
export function ReportItem() {
  const links = useReportLinks()
  const [open, setOpen] = useState(false)
  if (links === null) return null

  return (
    <div className="report" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="gear__item" aria-expanded={open} aria-controls="report-panel" onClick={() => setOpen(true)}>
        {t.report.row}
        <span className="report__arrow" aria-hidden="true">
          ◂
        </span>
      </button>
      {open && (
        <nav id="report-panel" className="queue gear report__flyout" aria-label={t.report.row}>
          <Outlinks links={links} className="gear__item report__link" />
          <Private links={links} />
        </nav>
      )}
    </div>
  )
}

/** The burger's row of it: the list unfolds down inside the sheet, indented behind a line, rows as tall as the others. */
export function ReportRows() {
  const links = useReportLinks()
  const [open, setOpen] = useState(false)
  if (links === null) return null

  return (
    <>
      <button type="button" className="gear__item" aria-expanded={open} aria-controls="report-rows" onClick={() => setOpen(!open)}>
        {t.report.row}
        <span className={open ? 'report__caret report__caret--open' : 'report__caret'} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div id="report-rows" className="report__rows">
          <Outlinks links={links} className="report__row" />
          <Private links={links} />
        </div>
      )}
    </>
  )
}
