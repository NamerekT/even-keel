import { useEffect, useRef, useState } from 'react'
import type { ProjectSettings } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { SlidersIcon } from '../ui/icons.js'
import './settings.css'

/** The address hash that opens the settings panel; a task id never equals it. */
export const SETTINGS_HASH = 'settings'

export function SettingsChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="tag tag--settings" aria-expanded={open} title={t.settings.title} onClick={onToggle}>
      <SlidersIcon />
      {t.settings.open}
    </button>
  )
}

interface Draft {
  prompt: string
  commands: string
}

const draftOf = (settings: ProjectSettings): Draft => ({ prompt: settings.prompt ?? '', commands: settings.beforeStart.join('\n') })
const linesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
// What the service would store, so a stray space or blank line is not an unsaved change.
const sameDraft = (a: Draft, b: Draft) => a.prompt.trim() === b.prompt.trim() && linesOf(a.commands).join('\n') === linesOf(b.commands).join('\n')

export function SettingsPanel({ project, settings, onClose }: { project: string; settings: ProjectSettings; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()
  const saved = draftOf(settings)
  const [draft, setDraft] = useState(saved)
  const [done, setDone] = useState(false)
  const previous = useRef(saved)
  const changed = !sameDraft(draft, saved)

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  // The config changed under an untouched form (a save, or the file edited by hand): show the new values.
  useEffect(() => {
    if (sameDraft(previous.current, saved)) return
    if (sameDraft(draft, previous.current)) setDraft(saved)
    previous.current = saved
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const edit = (next: Partial<Draft>) => {
    setDone(false)
    setDraft({ ...draft, ...next })
  }
  const save = async () => {
    if (await send('project/settings', { project, prompt: draft.prompt, beforeStart: linesOf(draft.commands) })) setDone(true)
  }

  return (
    <aside className="panel settings" aria-label={t.settings.title}>
      <header className="panel__head">
        <h2 className="panel__task settings__title">
          <SlidersIcon />
          {t.settings.title}
        </h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <p className="chain__hint">{t.settings.hint}</p>
      <form
        className="settings__form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="settings__field">
          <span className="settings__label">{t.settings.prompt}</span>
          <span className="settings__hint">{t.settings.promptHint}</span>
          <textarea
            className="settings__text"
            rows={5}
            value={draft.prompt}
            placeholder={t.settings.promptPlaceholder}
            onChange={(event) => edit({ prompt: event.target.value })}
          />
        </label>
        <label className="settings__field">
          <span className="settings__label">{t.settings.beforeStart}</span>
          <span className="settings__hint">{t.settings.beforeStartHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={4}
            spellCheck={false}
            value={draft.commands}
            placeholder={t.settings.beforeStartPlaceholder}
            onChange={(event) => edit({ commands: event.target.value })}
          />
        </label>
        <div className="settings__actions">
          <button type="submit" className="button button--primary" disabled={sending || !changed}>
            {t.settings.save}
          </button>
          {done && !changed && <span className="settings__saved">{t.settings.saved}</span>}
        </div>
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </form>
    </aside>
  )
}
