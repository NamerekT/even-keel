import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { SlidersIcon, TrackerIcon } from '../ui/icons.js'
import { GroupTabs, UnsavedDot } from './settingsParts.js'
import '../tools/addPackage.css'
import './sourceDialog.css'

/** A part of a source's settings: a tab of its window. A new part is one more entry. */
export interface SourceTab<T extends string = string> {
  id: T
  title: string
  render: () => ReactNode
  /** Whether the part holds edits nobody saved. */
  dirty: boolean
}

interface SourceDialogProps<T extends string> {
  /** The source's tracker kind, for its icon. */
  kind: string
  sourceKey: string
  /** The source's profile name, which names its tracker; the tracker's title without a profile. */
  title: string
  tabs: readonly SourceTab<T>[]
  /** A save is under way or the draft cannot be sent. */
  canSave: boolean
  failure: Notice | null
  /** Whether the save went through: then the window closes. */
  onSave: () => Promise<boolean>
  onRevert: () => void
  /** Closing keeps the edits: the draft lives on, the source's row shows its dot. */
  onClose: () => void
}

/** A source's line in the Tracker tab: its tracker and key, whether it keeps rules of its own, and the button to its window. */
export function SourceLine({ kind, title, sourceKey, own, dirty, onConfigure, menu, children }: {
  kind: string
  title: string
  sourceKey: string
  own: boolean
  dirty: boolean
  onConfigure: () => void
  menu?: ReactNode
  /** Under the line, across it: a note about the source. */
  children?: ReactNode
}) {
  return (
    <div className="source-line">
      <span className="source-line__what">
        <span className="source-line__name">
          <TrackerIcon kind={kind} />
          <span className="tag">{sourceKey}</span>
          <span className="source-line__title" title={title}>
            {title}
          </span>
        </span>
        <span className="source-line__rules">{own ? t.settings.sourceRulesOwn : t.settings.sourceRulesInherited}</span>
      </span>
      <span className="source-line__actions">
        {dirty && <UnsavedDot />}
        <button type="button" className="button button--small" onClick={onConfigure}>
          <SlidersIcon />
          {t.settings.sourceConfigure}
        </button>
        {menu}
      </span>
      {children !== undefined && <div className="source-line__note">{children}</div>}
    </div>
  )
}

/**
 * The settings of one source of the project's tasks (BTN-553), its main tracker or a feed: the parts as tabs across
 * the top, one save for all of them at the bottom.
 */
export function SourceDialog<T extends string>({ kind, sourceKey, title, tabs, canSave, failure, onSave, onRevert, onClose }: SourceDialogProps<T>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const [open, setOpen] = useState<T>(tabs[0]!.id)
  const tab = tabs.find((each) => each.id === open) ?? tabs[0]!
  const dirty = tabs.some((each) => each.dirty)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="add-package source-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title source-dialog__title">
            <TrackerIcon kind={kind} />
            <span className="tag">{sourceKey}</span>
            {title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="source-dialog__tabs">
          <GroupTabs groups={tabs} open={tab.id} dirty={(id) => tabs.find((each) => each.id === id)?.dirty === true} onOpen={setOpen} label={t.settings.sourceParts} />
        </div>
        <div className="add-package__body source-dialog__body" role="tabpanel" aria-labelledby={`settings-tab-${tab.id}`}>
          {tab.render()}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
        <footer className="add-package__foot">
          {dirty && <span className="settings__bar-text">{t.settings.sourceUnsaved}</span>}
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={!dirty} onClick={onRevert}>
            {t.settings.sourceRevert}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!dirty || !canSave}
            onClick={() => {
              void onSave().then((saved) => {
                if (saved) onClose()
              })
            }}
          >
            {t.settings.sourceSave}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
