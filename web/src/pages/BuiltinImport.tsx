import { useEffect, useId, useRef, useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { ImportAuthor, ImportAuthorKind } from '../../../src/tracker/import.js'
import type { ImportPlan, ImportState, ImportSwitching } from '../../../src/tracker/import-plan.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { Progress, Refusal } from './BuiltinExport.js'
import { authorChoices, pickAuthor } from './authorPicks.js'
import { ImportAuthors } from './ImportAuthors.js'
import { importPhaseOf } from './importPhase.js'
import { HelpTip } from './settingsParts.js'
import { checkMatched, Losses, shortKinds, TransferCheckTable, TransferMoves, TransferStatuses } from './TransferPlan.js'
import '../tools/addPackage.css'
import { CloseIcon } from '../ui/icons.js'
import './builtinExport.css'

const POLL_MS = 1_500

/**
 * "Move to the built-in tracker" of a project on another tracker (BTN-1406): the button and its window. A tracker that
 * cannot give its whole history yet (`TrackerChoice.imports`) has the button quiet, its tip saying the import comes later.
 */
export function BuiltinImportButton({ state, project, tracker }: { state: EvenKeelState; project: string; tracker: string }) {
  const [open, setOpen] = useState(false)
  const choice = state.config.trackers.find((each) => each.name === tracker)
  if (choice?.imports !== true) {
    return (
      <Tipped tip={t.transfer.imports.none} inline align="end">
        <button type="button" className="button button--small" aria-disabled="true">
          {t.transfer.imports.open}
        </button>
      </Tipped>
    )
  }
  return (
    <>
      <button type="button" className="button button--small" onClick={() => setOpen(true)}>
        {t.transfer.imports.open}
      </button>
      {open && <BuiltinImportDialog project={project} tracker={choice.title} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The window, the export's in the other direction (`BuiltinExport.tsx`): no fields — the source is the project's tracker,
 * the key and the numbers stay — so it opens on the plan, read from the source as a whole; then the import's meter while
 * it runs in the service, "Continue" after a stop, and the check with the switch at its end. Its state is the
 * service's, so a window opened again comes back to the step the import is at.
 */
function BuiltinImportDialog({ project, tracker, onClose }: { project: string; tracker: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  // The window's reads stay off the page's loader: the window shows its own (BTN-1452).
  const { query, read: quiet } = useLive()
  const [imported, setImported] = useState<ImportState | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [planRefusal, setPlanRefusal] = useState<Notice | null>(null)
  const [refusal, setRefusal] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const picks = useRef(0)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const read = async () => {
    try {
      setImported(await quiet<ImportState>('builtin/import/state', { project }))
    } catch (reason) {
      setRefusal(noticeOf(reason))
    }
  }
  useEffect(() => void read(), [project])

  const phase = importPhaseOf(imported)
  const planReading = phase === 'pick' && plan === null && planRefusal === null
  // Each answer while the plan's read, the import or its switch goes on asks for the next one.
  useEffect(() => {
    if (imported?.running !== true && imported?.switching == null && imported?.planning == null && !planReading) return
    const timer = setTimeout(() => void read(), POLL_MS)
    return () => clearTimeout(timer)
  }, [imported, planReading])
  // A switch followed here and gone with its import is done: the project is on the built-in tracker.
  const wasSwitching = useRef(false)
  useEffect(() => {
    if (phase === 'switching') wasSwitching.current = true
    else if (wasSwitching.current && imported?.from === null) onClose()
  }, [phase, imported])
  useEffect(() => {
    if (phase !== 'pick' || plan !== null || planRefusal !== null) return
    let live = true
    quiet<ImportPlan>('builtin/import/plan', { project }).then(
      (answer) => live && setPlan(answer),
      (reason) => live && setPlanRefusal(noticeOf(reason)),
    )
    return () => {
      live = false
    }
  }, [phase, project])

  const run = async (name: string, body: Record<string, unknown>) => {
    setBusy(true)
    setRefusal(null)
    try {
      return await query<unknown>(name, body)
    } catch (reason) {
      setRefusal(noticeOf(reason))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  // A pick shows at once; the plan is asked again with it, counted from the service's read, and only the answer to the
  // last pick is taken.
  const pick = (author: ImportAuthor, as: ImportAuthorKind) => {
    if (plan === null) return
    const authors = pickAuthor(plan.authors, author, as)
    setPlan({ ...plan, authors })
    const asked = ++picks.current
    quiet<ImportPlan>('builtin/import/plan', { project, authors: authorChoices(authors) }).then(
      (answer) => asked === picks.current && setPlan(answer),
      (reason) => asked === picks.current && setRefusal(noticeOf(reason)),
    )
  }
  // "Move", "Continue" and "Repeat" alike: the service goes on from what it has, and a finished import passes again. The
  // authors go only with the first start: the service keeps them from then on.
  const start = async () => {
    picks.current += 1
    // A start past the kept read reads the source again: its meter shows meanwhile.
    setTimeout(() => void read(), POLL_MS / 3)
    const answer = await run('builtin/import/start', phase === 'pick' && plan !== null ? { project, authors: authorChoices(plan.authors) } : { project })
    if (answer !== undefined) setImported(answer as ImportState)
  }
  // The switch takes minutes on a big project: the state is read on while it goes, for its meter.
  const switchOver = async (anyway: boolean) => {
    const asked = run('builtin/import/switch', { project, ...(anyway ? { anyway } : {}) })
    setTimeout(() => void read(), POLL_MS / 3)
    if ((await asked) !== undefined) onClose()
    else void read()
  }

  const planning = imported?.planning ?? null
  const reading = refusal === null && planning === null && (phase === 'read' || planReading)
  const failed = phase === 'resume' ? imported!.failed : null
  const check = phase === 'finished' ? imported!.check : null
  const checkNotice = phase === 'finished' ? checkNoticeOf(imported!, tracker) : null
  const matched = check !== null && checkMatched(check)
  const shownRefusal = refusal ?? (phase === 'pick' ? planRefusal : null)

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
            {t.transfer.imports.title}
            <HelpTip text={t.transfer.imports.leadTip(tracker)} align="start" />
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body transfer__body">
          <p className="add-package__note">{phase === 'finished' ? t.transfer.imports.done(imported!.total, tracker) : t.transfer.imports.lead(tracker)}</p>
          <Loading busy={reading} label={t.transfer.imports.reading(tracker)} fit="block">
            {phase === 'pick' && plan !== null && (
              <>
                <TransferMoves counts={plan.counts} />
                <TransferStatuses rows={plan.statuses} tracker={tracker} direction="import" />
                <ImportAuthors authors={plan.authors} onPick={busy ? null : pick} />
                <Losses plan={plan} recheck={null} checking={false} direction="import" />
              </>
            )}
            {planning !== null && (planReading || phase === 'running') && (
              <>
                <Meter name={t.transfer.imports.planning} tip={t.transfer.imports.planningTip(tracker)} done={planning.done} total={planning.total} />
                <p className="add-package__note">{t.transfer.imports.planningNote}</p>
              </>
            )}
            {planning === null && (phase === 'running' || phase === 'resume' || phase === 'finished') && <Progress exported={imported!} direction="import" />}
            {planning === null && phase === 'running' && <p className="add-package__note">{t.transfer.running}</p>}
            {phase === 'switching' && (
              <>
                <SwitchMeter switching={imported!.switching!} tracker={tracker} />
                <p className="add-package__note">{t.transfer.imports.switchingNote}</p>
              </>
            )}
            {check !== null && <TransferCheckTable check={check} direction="import" tracker={tracker} />}
          </Loading>
        </div>
        {phase === 'resume' && refusal === null && (
          <p role="alert" className={`notice ${failed === null ? 'notice--warn' : 'notice--error'} add-package__failure`}>
            {failed === null ? t.transfer.stopped : say(failed)}
          </p>
        )}
        {checkNotice !== null && refusal === null && (
          <p role="alert" className={`notice notice--${checkNotice.tone} add-package__failure`}>
            {checkNotice.text}
          </p>
        )}
        {shownRefusal !== null && <Refusal project={project} refusal={shownRefusal} />}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy && phase !== 'switching'} onClick={onClose}>
            {phase === 'pick' ? t.common.cancel : t.common.close}
          </button>
          {phase === 'pick' && (
            <button type="button" className="button button--primary" disabled={busy || plan === null || plan.tasks.length === 0} onClick={() => void start()}>
              {t.transfer.start}
            </button>
          )}
          {phase === 'resume' && (
            <button type="button" className="button button--primary" disabled={busy} onClick={() => void start()}>
              {t.transfer.resume}
            </button>
          )}
          {checkNotice !== null && (
            <button type="button" className="button" disabled={busy} onClick={() => void start()}>
              {t.transfer.retry}
            </button>
          )}
          {phase === 'finished' && (
            <button type="button" className="button button--primary" disabled={busy || check === null} onClick={() => void switchOver(!matched)}>
              {check === null || matched ? t.transfer.imports.switchTo : t.transfer.switchWithout}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}

/** The switch's step with its count of tasks; the move itself has none. */
function SwitchMeter({ switching, tracker }: { switching: ImportSwitching; tracker: string }) {
  return <Meter name={t.transfer.imports.switching[switching.stage]} tip={t.transfer.imports.switchingTips[switching.stage](tracker)} done={switching.done} total={switching.total} />
}

/** A step with "N of M"; without a total the bar runs on its own. */
function Meter({ name, tip, done, total }: { name: string; tip: string; done: number; total: number }) {
  const counted = total > 0
  return (
    <div className="transfer__meter">
      <Tipped tip={tip} focusable inline align="start" className="transfer__meter-name">
        {name}
      </Tipped>
      <progress max={Math.max(total, 1)} {...(counted ? { value: done } : {})} aria-label={name} />
      <span className="transfer__figures">{counted ? t.transfer.progressOf(done, total) : ''}</span>
    </div>
  )
}

/** The finished import's word under the window: why its check is missing or did not match; `null` — it matched. */
function checkNoticeOf(imported: ImportState, tracker: string): { tone: 'warn' | 'error'; text: string } | null {
  if (imported.checkFailed !== null) return { tone: 'error', text: say(imported.checkFailed) }
  if (imported.check === null) return { tone: 'warn', text: t.transfer.checkNone }
  return checkMatched(imported.check) ? null : { tone: 'warn', text: t.transfer.imports.mismatch(shortKinds(imported.check), tracker) }
}
