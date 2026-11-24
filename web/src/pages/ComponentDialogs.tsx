import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Fact, FactList } from '../ui/blocks.js'
import { CheckIcon, CloseIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { DAY } from './CardFields.js'
import { FieldHead, HelpTip } from './settingsParts.js'
import '../tools/addPackage.css'

/** A component as `builtin/components` lists it. */
export interface ComponentRow {
  id: string
  name: string
  description: string
  createdAt: string
  open: number
  total: number
}

/** The modal frame both windows share: on the phone a sheet from the bottom (`componentList.css`). */
export function Modal({ title, onClose, onSubmit, children, foot, failure, busy, className }: { title: string; onClose: () => void; onSubmit: () => void; children: ReactNode; foot: ReactNode; failure: Notice | null; busy: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, () => {
    if (!busy) onClose()
  })
  const heading = useId()
  useEffect(() => {
    const box = dialog.current
    if (box !== null && !box.open) box.showModal()
  }, [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onSubmit()
  }
  return createPortal(
    <dialog
      ref={dialog}
      className={`add-package add-package--narrow component-dialog${className === undefined ? '' : ` ${className}`}`}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onClose()
      }}
      {...backdrop}
    >
      <form className="add-package__frame" onSubmit={submit}>
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.components.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body">{children}</div>
        {failure !== null && (
          <p role="alert" className="notice notice--error add-package__failure">
            {say(failure)}
          </p>
        )}
        <footer className="add-package__foot">{foot}</footer>
      </form>
    </dialog>,
    document.body,
  )
}

/** A write that closes the window, or keeps it open with the refusal. */
export function useWrite(onDone: () => void) {
  const { query } = useLive()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const run = async (name: string, body: Record<string, unknown>) => {
    setBusy(true)
    setFailure(null)
    try {
      await query(name, body)
      onDone()
    } catch (reason) {
      setFailure(noticeOf(reason))
      setBusy(false)
    }
  }
  return { busy, failure, run }
}

function Counts({ row, created }: { row: ComponentRow; created: boolean }) {
  return (
    <FactList className="component-dialog__facts">
      <Fact label={t.components.openCount}>
        <dd>{row.open}</dd>
      </Fact>
      <Fact label={t.components.closedCount}>
        <dd>{row.total - row.open}</dd>
      </Fact>
      {created && (
        <Fact label={t.components.created}>
          <dd>{DAY().format(new Date(row.createdAt))}</dd>
        </Fact>
      )}
    </FactList>
  )
}

/** Creating a component (`row` null) or changing one: its name and its Markdown description. */
export function ComponentEditor({ project, row, onRemove, onDone, onClose }: { project: string; row: ComponentRow | null; onRemove?: () => void; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '')
  const [description, setDescription] = useState(row?.description ?? '')
  const { busy, failure, run } = useWrite(onDone)
  const ready = name.trim() !== '' && !busy && (row === null || name !== row.name || description !== row.description)
  const save = () => {
    if (ready) void run('builtin/component', { project, ...(row === null ? {} : { id: row.id }), name: name.trim(), description })
  }
  return (
    <Modal
      title={row === null ? t.components.newTitle : t.components.editTitle(row.name)}
      onClose={onClose}
      onSubmit={save}
      failure={failure}
      busy={busy}
      foot={
        <>
          {onRemove !== undefined && (
            <button type="button" className="button component-dialog__remove" disabled={busy} onClick={onRemove}>
              {t.components.remove}
            </button>
          )}
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t.components.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={!ready}>
            {row === null ? t.components.create : t.components.save}
          </button>
        </>
      }
    >
      {row !== null && <Counts row={row} created />}
      <div className="settings__field">
        <FieldHead label={t.components.nameField} htmlFor="component-name" />
        <input
          id="component-name"
          className="settings__text"
          autoComplete="off"
          autoFocus
          value={name}
          disabled={busy}
          aria-invalid={failure?.code === 'builtin.componentTaken'}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="settings__field">
        <FieldHead label={t.components.descriptionField} htmlFor="component-description" mark={<span className="tag">{t.components.markdown}</span>} />
        <textarea
          id="component-description"
          className="settings__text component-dialog__description"
          rows={5}
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
    </Modal>
  )
}

type Where = 'other' | 'none'

/** Deleting a component: its tasks, closed ones too, go to another component or to none. */
export function ComponentRemoval({ project, row, others, onDone, onClose }: { project: string; row: ComponentRow; others: ComponentRow[]; onDone: () => void; onClose: () => void }) {
  const [where, setWhere] = useState<Where>(others.length > 0 ? 'other' : 'none')
  const [to, setTo] = useState(others[0]?.id ?? '')
  const { busy, failure, run } = useWrite(onDone)
  const remove = () => {
    if (!busy) void run('builtin/component/delete', { project, id: row.id, ...(where === 'other' && row.total > 0 ? { to } : {}) })
  }
  const choice = (value: Where, title: string, body: ReactNode, off = false) => (
    <label className={['component-choice', where === value && 'component-choice--on', off && 'component-choice--off'].filter(Boolean).join(' ')}>
      <input type="radio" name="component-where" className="component-choice__radio" checked={where === value} disabled={off || busy} onChange={() => setWhere(value)} />
      <span className="component-choice__title">{title}</span>
      {body}
      {where === value && (
        <span className="component-choice__mark" aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </label>
  )
  return (
    <Modal
      title={t.components.removeTitle(row.name)}
      onClose={onClose}
      onSubmit={remove}
      failure={failure}
      busy={busy}
      foot={
        <>
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t.components.cancel}
          </button>
          <button type="submit" className="button button--danger" disabled={busy || (row.total > 0 && where === 'other' && to === '')}>
            {t.components.remove}
          </button>
        </>
      }
    >
      <Counts row={row} created={false} />
      {row.total > 0 && (
        <div className="settings__field" role="radiogroup" aria-label={t.components.removeWhere}>
          <span className="settings__head-row">
            <span className="settings__label">{t.components.removeWhere}</span>
            <HelpTip text={t.components.removeHint} />
          </span>
          <div className="component-choices">
            {choice(
              'other',
              t.components.moveTo,
              others.length === 0 ? (
                <span className="component-choice__desc">{t.components.noOther}</span>
              ) : (
                <Select
                  value={to}
                  label={t.components.moveToPick}
                  className="settings__text"
                  disabled={busy || where !== 'other'}
                  options={others.map((each) => ({ value: each.id, label: each.name }))}
                  onChange={setTo}
                />
              ),
              others.length === 0,
            )}
            {choice('none', t.components.moveNone, <span className="component-choice__desc">{t.components.moveNoneNote}</span>)}
          </div>
        </div>
      )}
    </Modal>
  )
}
