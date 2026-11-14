import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { BUILTIN } from '../../../src/builtin/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { SlidersIcon, TrackerIcon } from '../ui/icons.js'
import { useHeightGlide } from '../ui/useHeightGlide.js'
import { GroupTabs, UnsavedDot } from './settingsParts.js'
import { tablesValid, useTableDraft } from './settingsTableDraft.js'
import { pendingRow } from './settingsDraft.js'
import '../tools/addPackage.css'
import './sourceDialog.css'

/** A part of a source's settings: a tab of its window. A new part is one more entry. */
export interface SourceTab<T extends string = string> {
  id: T
  title: string
  render: () => ReactNode
  /** Whether the part holds edits nobody saved. */
  dirty: boolean
  fields?: readonly string[]
}

interface SourceDialogProps<T extends string> {
  /** The source's tracker kind, for its icon. */
  kind: string
  sourceKey: string
  /** The source's profile name, which names its tracker; the tracker's title without a profile. */
  title: string
  tabs: readonly SourceTab<T>[]
  /** The tab the window opens on, when it has it and no tab holds an invalid field; the first one otherwise. */
  initialTab?: string
  /** A save is under way or the draft cannot be sent. */
  canSave: boolean
  failure: Notice | null
  /** What holds for the source whatever the tab, above its content: its repository open to anyone (BTN-1134). */
  note?: ReactNode
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
        {/* The built-in tracker has no profile: its project tasks come from the shared settings (BTN-769). */}
        <span className="source-line__rules">{own ? t.settings.sourceRulesOwn : kind === BUILTIN ? t.settings.sourceRulesShared : t.settings.sourceRulesInherited}</span>
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
export function SourceDialog<T extends string>({ kind, sourceKey, title, tabs, initialTab, canSave, failure, note, onSave, onRevert, onClose }: SourceDialogProps<T>) {
  const tableDraft = useTableDraft()
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const invalidTab = tabs.find((each) => each.fields?.some((key) => tableDraft?.draft.adding?.[key]?.valid === false))
  const asked = tabs.find((each) => each.id === initialTab)
  const [open, setOpen] = useState<T>(invalidTab?.id ?? asked?.id ?? tabs[0]!.id)
  const tab = tabs.find((each) => each.id === open) ?? tabs[0]!
  const dirty = tabs.some((each) => each.dirty)
  const frame = useRef<HTMLDivElement>(null)
  useHeightGlide(frame, tab.id)

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
      <div ref={frame} className="add-package__frame">
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
        {tabs.length > 1 && (
          <div className="source-dialog__tabs">
            <GroupTabs groups={tabs} open={tab.id} dirty={(id) => tabs.find((each) => each.id === id)?.dirty === true} onOpen={setOpen} label={t.settings.sourceParts} />
          </div>
        )}
        <div
          className="add-package__body source-dialog__body"
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={tabs.length > 1 ? `settings-tab-${tab.id}` : undefined}
        >
          {note}
          {tab.render()}
        </div>
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
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
              const valid = tablesValid(dialog.current!)
              if (invalidTab !== undefined && tableDraft !== null) {
                tableDraft.setDraft((before) => (invalidTab.fields ?? []).reduce((next, key) => {
                  const row = next.adding?.[key]
                  return row === undefined ? next : pendingRow(next, key, { ...row, checked: true })
                }, before))
                setOpen(invalidTab.id)
                return
              }
              if (!valid) return
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
