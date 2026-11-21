import { useEffect, useId, useRef, useState } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import type { TransferReport, TransferSummary } from '../../../src/tracker/transfer-check.js'
import { formatFullTime, formatStamp } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Loading } from '../ui/Loader.js'
import { Progress } from './BuiltinExport.js'
import { Section } from './settingsParts.js'
import { Losses, TransferCheckTable, TransferMoves, TransferStatuses } from './TransferPlan.js'
import { takeReport, usePendingReport } from './transferStore.js'
import '../tools/addPackage.css'
import { CloseIcon } from '../ui/icons.js'
import './builtinExport.css'

const titleOf = (state: EvenKeelState, kind: string) => state.config.trackers.find((each) => each.name === kind)?.title ?? kind

/**
 * "Transfers" of the project's Tracker tab (BTN-1291): a row a finished transfer, the latest first; a row opens its
 * report — the window the transfer had, read-only, as it was at the switch. `tracker` — the project's tracker now: a
 * switch changes it, and the list is read again.
 */
export function TransferReports({ state, project, tracker }: { state: EvenKeelState; project: string; tracker: string }) {
  const { query } = useLive()
  const [list, setList] = useState<TransferSummary[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const pending = usePendingReport(project)

  useEffect(() => {
    let live = true
    query<{ transfers: TransferSummary[] }>('builtin/transfers', { project }).then(
      (answer) => live && setList(answer.transfers),
      () => live && setList([]),
    )
    return () => {
      live = false
    }
  }, [project, tracker])
  useEffect(() => {
    const id = takeReport(project)
    if (id !== undefined) setOpen(id)
  }, [pending, project])

  const now = new Date()
  return (
    <>
      {list.length > 0 && (
        <Section title={t.transfer.reports} hint={t.transfer.reportsHint}>
          <ul className="transfer-reports">
            {list.map((each) => (
              <li key={each.id} className="transfer-reports__row">
                <button type="button" className="transfer-reports__open" onClick={() => setOpen(each.id)}>
                  <span>
                    {t.transfer.reportLine(each.direction, titleOf(state, each.tracker))}, {formatStamp(each.switchedAt, now)}, {t.transfer.reportTasks(each.tasks)}
                  </span>
                  <span className={each.matched ? 'transfer-reports__word' : 'transfer-reports__word transfer-reports__word--bad'}>
                    {each.matched ? t.transfer.reportMatched : t.transfer.reportMismatched}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {open !== null && <TransferReportDialog state={state} id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function TransferReportDialog({ state, id, onClose }: { state: EvenKeelState; id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { query } = useLive()
  const [report, setReport] = useState<TransferReport | null | undefined>(undefined)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  useEffect(() => {
    let live = true
    query<{ report: TransferReport | null }>('builtin/transfer', { id }).then(
      (answer) => live && setReport(answer.report),
      () => live && setReport(null),
    )
    return () => {
      live = false
    }
  }, [id])

  const tracker = report == null ? '' : titleOf(state, report.tracker)
  const tasks = report?.check.rows.find((row) => row.kind === 'tasks')
  const moved = tasks?.target ?? report?.plan.counts.tasks ?? 0
  const all = { tasks: moved, created: moved, linked: moved, attached: moved, journaled: moved, marked: moved }
  return (
    <dialog
      ref={dialog}
      className="add-package transfer"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title transfer__title">
            {report == null ? t.transfer.reports : t.transfer.reportTitle(report.direction, tracker)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body transfer__body">
          <Loading busy={report === undefined} label={t.transfer.reports} fit="block">
            {report === null && <p className="add-package__note">{t.transfer.reportGone}</p>}
            {report != null && (
              <>
                <p className="add-package__note">{t.transfer.reportWhen(formatFullTime(report.switchedAt), report.key, report.sourceKey)}</p>
                <TransferMoves counts={report.plan.counts} title={t.transfer.reportMoves} />
                <TransferStatuses rows={report.plan.statuses} tracker={tracker} direction={report.direction} />
                <Losses plan={report.plan} recheck={null} checking={false} direction={report.direction} title={t.transfer.reportLosses} none={t.transfer.reportLossesNone} />
                <Progress exported={{ progress: all, total: tasks?.source ?? moved }} direction={report.direction} />
                <TransferCheckTable check={report.check} direction={report.direction} tracker={tracker} />
              </>
            )}
          </Loading>
        </div>
        {report?.matched === false && <p className="notice notice--warn add-package__failure">{t.transfer.reportMismatch}</p>}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button button--primary" onClick={onClose}>
            {t.common.close}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
