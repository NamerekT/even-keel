import { useEffect, useId, useRef, useState } from 'react'
import type { ExportState } from '../../../src/tracker/export.js'
import { BUILTIN } from '../../../src/builtin/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { ExportLoss, ExportPlan } from '../../../src/tracker/export.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { EMPTY_FIELDS, keyOfTyped, keyTyped, placeFields, placeOf, shapeOf, typedIn, type WizardFields } from './projectWizard.js'
import { ErrorStrip, FieldHead } from './settingsParts.js'
import { TrackerFields } from './TrackerFields.js'
import '../tools/addPackage.css'
import './builtinExport.css'

const POLL_MS = 1_500
const CHECK_DELAY_MS = 400
/** The losses a person fixes in the target tracker before a new check; the rest are the tracker's own. */
const FIXABLE = new Set<ExportLoss['kind']>(['labels', 'milestones'])
/** The refusals that name the key: they go under its field where the window shows one. */
const KEY_REFUSALS = new Set(['switch.samePrefix', 'switch.prefixTaken'])

type Phase = 'read' | 'pick' | 'running' | 'resume' | 'finished'

/** "Move to another tracker" of a built-in project's Tracker tab (BTN-1075): the button and its window. */
export function BuiltinExportButton({ state, project }: { state: EvenKeelState; project: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="button button--small" onClick={() => setOpen(true)}>
        {t.transfer.open}
      </button>
      {open && <BuiltinExportDialog state={state} project={project} onClose={() => setOpen(false)} />}
    </>
  )
}

function phaseOf(exported: ExportState | null): Phase {
  if (exported === null) return 'read'
  if (exported.running) return 'running'
  if (exported.progress.tasks === 0 && exported.finishedAt === null) return 'pick'
  const through = exported.failed === null && exported.finishedAt !== null && exported.progress.marked >= exported.total
  return through ? 'finished' : 'resume'
}

/** The target as the routes take it: the wizard's tracker fields, trimmed. */
function targetOf(fields: WizardFields) {
  return { profile: fields.profile, place: placeOf({ ...fields, trackerProject: fields.trackerProject.trim() }), key: fields.key.trim() }
}

/**
 * The window: the target picked as the wizard picks a tracker and checked by the copy's plan; the copy's progress, read
 * from the service while it runs there; the switch once every task is through. Its state is the service's, so a window
 * opened again, or after a reload, comes back to the step the copy is at.
 */
function BuiltinExportDialog({ state, project, onClose }: { state: EvenKeelState; project: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { query } = useLive()
  const [exported, setExported] = useState<ExportState | null>(null)
  const [typed, setTyped] = useState<WizardFields>(EMPTY_FIELDS)
  const [checked, setChecked] = useState<{ basis: string; plan: ExportPlan | null; refusal: Notice | null } | null>(null)
  const [checking, setChecking] = useState(false)
  const [recheck, setRecheck] = useState(0)
  const [refusal, setRefusal] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const read = async () => {
    try {
      setExported(await query<ExportState>('builtin/export/state', { project }))
    } catch (reason) {
      setRefusal(noticeOf(reason))
    }
  }
  useEffect(() => void read(), [project])
  // Each answer while the copy runs asks for the next one.
  useEffect(() => {
    if (exported?.running !== true) return
    const timer = setTimeout(() => void read(), POLL_MS)
    return () => clearTimeout(timer)
  }, [exported])

  const phase = phaseOf(exported)
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker && kind.kind !== BUILTIN)
  const profiles = state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
  const fixed = exported?.target != null && phase !== 'pick' ? fieldsOfTarget(state, exported.target) : null
  const fields = fixed ?? typed
  const shape = shapeOf(state.config.trackers.find((each) => each.name === fields.tracker))
  const tracker = state.config.trackers.find((each) => each.name === fields.tracker)?.title ?? fields.tracker
  const target = targetOf(fields)
  const basis = JSON.stringify(target)
  const ready = phase === 'pick' && target.profile !== '' && target.key !== ''

  useEffect(() => {
    if (!ready) return
    let live = true
    setChecking(true)
    const timer = setTimeout(() => {
      query<ExportPlan>('builtin/export/plan', { project, ...target }).then(
        (plan) => live && setChecked({ basis, plan, refusal: null }),
        (reason) => live && setChecked({ basis, plan: null, refusal: noticeOf(reason) }),
      ).finally(() => live && setChecking(false))
    }, CHECK_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [basis, recheck, ready])

  const shown = ready && checked?.basis === basis ? checked : null
  const keyRefused = shown?.refusal != null && KEY_REFUSALS.has(shown.refusal.code) && keyTyped(shape) ? shown.refusal : null
  const status = !ready
    ? null
    : shown === null || checking
      ? { tone: 'plain' as const, text: t.transfer.checking }
      : shown.refusal !== null
        ? keyRefused === null ? { tone: 'error' as const, text: say(shown.refusal) } : null
        : { tone: 'ok' as const, text: t.transfer.planOk(shown.plan!.tasks.length), short: t.transfer.planShort(shown.plan!.tasks.length) }

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
  const start = async () => {
    const answer = await run('builtin/export/start', { project, ...(fixed === null ? target : exported!.target!) })
    if (answer !== undefined) setExported(answer as ExportState)
  }
  const switchOver = async () => {
    if ((await run('builtin/export/switch', { project })) !== undefined) onClose()
  }

  const plan = shown?.plan ?? null
  const fixable = plan?.losses.some((loss) => FIXABLE.has(loss.kind) && loss.names.length > 0) ?? false
  const failed = phase === 'resume' ? exported!.failed : null

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
          <h2 id={heading} className="add-package__title">
            {t.transfer.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body transfer__body">
          <Loading busy={phase === 'read' && refusal === null} label={t.transfer.checking} fit="block">
            <p className="add-package__note">{phase === 'finished' ? t.transfer.done(exported!.total, tracker) : t.transfer.lead}</p>
            <TrackerFields
              ids={(field) => `transfer-${field}`}
              state={state}
              fields={fields}
              profiles={profiles}
              kinds={kinds}
              profileHint={fixed === null ? t.transfer.profileHint : `${t.transfer.profileHint} ${t.transfer.locked}`}
              profileLocked={fixed !== null || busy}
              projectLocked={fixed !== null || busy}
              status={status}
              onChange={(change) => setTyped(change)}
            />
            {keyTyped(shape) && (
              <div className="settings__row tracker-fields__row">
                <div className="settings__field">
                  <FieldHead label={t.transfer.key} hint={t.transfer.keyHint} htmlFor="transfer-key" />
                  <ErrorStrip error={keyRefused}>
                    <input
                      id="transfer-key"
                      className="settings__text settings__text--mono tracker-fields__wide"
                      autoComplete="off"
                      spellCheck={false}
                      value={fields.key}
                      placeholder="ABCGH"
                      disabled={fixed !== null || busy}
                      aria-invalid={keyRefused !== null}
                      onChange={(event) => setTyped((before) => typedIn(before, 'key', keyOfTyped(event.target.value)))}
                    />
                  </ErrorStrip>
                </div>
              </div>
            )}
            {phase === 'pick' && plan !== null && <Losses plan={plan} recheck={fixable ? () => setRecheck((count) => count + 1) : null} checking={checking} />}
            {phase !== 'pick' && phase !== 'read' && <Progress exported={exported!} />}
            {phase === 'running' && <p className="add-package__note">{t.transfer.running}</p>}
          </Loading>
        </div>
        {phase === 'resume' && refusal === null && (
          <p role="alert" className={`notice ${failed === null ? 'notice--warn' : 'notice--error'} add-package__failure`}>
            {failed === null ? t.transfer.stopped : say(failed)}
          </p>
        )}
        {refusal !== null && <Refusal project={project} refusal={refusal} />}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {phase === 'pick' ? t.common.cancel : t.common.close}
          </button>
          {phase === 'pick' && (
            <button type="button" className="button button--primary" disabled={busy || checking || plan === null || plan.tasks.length === 0} onClick={() => void start()}>
              {fixable ? t.transfer.startWithout : t.transfer.start}
            </button>
          )}
          {phase === 'resume' && (
            <button type="button" className="button button--primary" disabled={busy} onClick={() => void start()}>
              {t.transfer.resume}
            </button>
          )}
          {phase === 'finished' && (
            <button type="button" className="button button--primary" disabled={busy} onClick={() => void switchOver()}>
              {t.transfer.switchTo(tracker)}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}

/** The copy's target back in the fields it was typed in: shown fixed once tasks went there. */
function fieldsOfTarget(state: EvenKeelState, target: NonNullable<ExportState['target']>): WizardFields {
  const kind = state.profiles.profiles.find((each) => each.id === target.profile)?.kind ?? ''
  const shape = shapeOf(state.config.trackers.find((each) => each.name === kind))
  return { ...EMPTY_FIELDS, profile: target.profile, tracker: kind, key: target.key, ...placeFields(shape, target.key, target.place) }
}

/** What the target leaves behind, a line per kind: its names where they are names, the tasks in a tip of their count. */
function Losses({ plan, recheck, checking }: { plan: ExportPlan; recheck: (() => void) | null; checking: boolean }) {
  return (
    <section className="transfer__losses" aria-label={t.transfer.losses}>
      <header className="transfer__losses-head">
        <h3 className="transfer__losses-title">{t.transfer.losses}</h3>
        {recheck !== null && (
          <button type="button" className="button button--small" disabled={checking} onClick={recheck}>
            {t.transfer.recheck}
          </button>
        )}
      </header>
      {plan.losses.length === 0 ? (
        <p className="transfer__none">{t.transfer.lossesNone}</p>
      ) : (
        <ul className="transfer__loss-list">
          {plan.losses.map((loss) => (
            <li key={loss.kind} className="transfer__loss">
              <Tipped tip={t.transfer.kindTips[loss.kind]} focusable inline align="start" className="transfer__kind">
                {t.transfer.kinds[loss.kind]}
              </Tipped>
              {loss.names.length > 0 && <span className="transfer__names">{loss.names.join(', ')}</span>}
              {loss.tasks.length > 0 && (
                <Tipped tip={t.transfer.lossTip(loss.tasks)} focusable inline className="transfer__count">
                  {t.transfer.lossTasks(loss.tasks.length)}
                </Tipped>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** "N of M" as the download meter shows its megabytes: the word, a bar, the figures. */
function Progress({ exported }: { exported: ExportState }) {
  const done = exported.progress.marked
  const total = Math.max(exported.total, done)
  return (
    <div className="transfer__meter">
      <span className="transfer__meter-name">{t.transfer.progress}</span>
      <progress max={Math.max(total, 1)} value={total === 0 ? 1 : done} aria-label={t.transfer.progress} />
      <span className="transfer__figures">{t.transfer.progressOf(done, total)}</span>
    </div>
  )
}

/** A refused start or switch; a switch held by the running chain gets the button that stops it. */
function Refusal({ project, refusal }: { project: string; refusal: Notice }) {
  const { state } = useLive()
  const { send, sending } = useCommand()
  const runs = (refusal.items ?? []).some((item) => item.code === 'switch.chainRuns')
  const stop = async () => {
    if (state?.chain.queue.includes(project) === true && !(await send('chain/dequeue', { project }))) return
    await send('chain/stop', { project })
  }
  const items = (refusal.items ?? []).map(say)
  return (
    <div role="alert" className="notice notice--error add-package__failure transfer__refusal">
      <div className="transfer__refusal-text">
        {say({ ...refusal, items: undefined })}
        {items.length > 0 && ':'}
        {items.length > 0 && (
          <ul className="transfer__refusal-items">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      {runs && (
        <button type="button" className="button button--small" disabled={sending} onClick={() => void stop()}>
          {t.transfer.stopChain}
        </button>
      )}
    </div>
  )
}
