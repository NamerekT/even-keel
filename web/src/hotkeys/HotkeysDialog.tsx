import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS, type HotkeyAction, type HotkeyBindings } from '../../../src/hotkeys.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Tipped } from '../ui/Tipped.js'
import { comboOf, formatCombo, refusalOf, type Refusal } from './combo.js'
import { useHotkeyLayout } from './useHotkeys.js'
import '../tools/addPackage.css'
import './hotkeys.css'

interface Refused {
  action: HotkeyAction
  combo: string
  refusal: Refusal
}

/**
 * The gear's "Hotkeys" (BTN-880): a row per action with its combination, "Change" records the next press and Esc
 * cancels it. Each change is sent at once as the browser's whole layout; the double click is shown, not changed.
 */
export function HotkeysDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { browser, own, current, mac } = useHotkeyLayout()
  const { send, sending, failure } = useCommand()
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [refused, setRefused] = useState<Refused | null>(null)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const save = (bindings: HotkeyBindings) => void send('hotkeys/save', { browser, bindings })
  const assign = (action: HotkeyAction, combo: string | null) => {
    const { [action]: _, ...rest } = own
    save(combo === null || combo === DEFAULT_HOTKEYS[action] ? rest : { ...rest, [action]: combo })
  }
  const record = (action: HotkeyAction | null) => {
    setRecording(action)
    setRefused(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (recording === null) return
    event.preventDefault()
    event.stopPropagation()
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    if (event.key === 'Escape' && plain) return record(null)
    const combo = comboOf(event, mac)
    if (combo === null) return
    const refusal = refusalOf(combo, recording, current)
    if (refusal !== null) return setRefused({ action: recording, combo, refusal })
    record(null)
    assign(recording, combo)
  }

  return (
    <dialog
      ref={dialog}
      className="add-package hotkeys"
      aria-labelledby={heading}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        if (recording !== null) record(null)
        else onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {t.hotkeys.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <p className="add-package__note">{t.hotkeys.lead}</p>
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
          <ul className="hotkeys__list">
            {HOTKEY_ACTIONS.map((action) => (
              <li key={action} className="hotkeys__row">
                <Tipped className="hotkeys__name" tip={t.hotkeys.tips[action]} inline focusable>
                  {t.hotkeys.actions[action]}
                </Tipped>
                {recording === action ? (
                  <Tipped className="hotkeys__combo hotkeys__combo--recording" tip={t.hotkeys.recordingTip} inline>
                    {t.hotkeys.recording}
                  </Tipped>
                ) : (
                  <kbd className="hotkeys__combo">{formatCombo(current[action], mac)}</kbd>
                )}
                <span className="hotkeys__buttons">
                  {own[action] !== undefined && recording !== action && (
                    <button type="button" className="button button--small" disabled={sending} onClick={() => assign(action, null)}>
                      {t.hotkeys.reset}
                    </button>
                  )}
                  <button type="button" className="button button--small" disabled={sending} onClick={() => record(recording === action ? null : action)}>
                    {recording === action ? t.hotkeys.cancel : t.hotkeys.change}
                  </button>
                </span>
                {refused?.action === action && (
                  <p className="hotkeys__error" role="alert">
                    {refusalText(refused, mac)}
                  </p>
                )}
              </li>
            ))}
            <li className="hotkeys__row hotkeys__row--fixed">
              <span className="hotkeys__name">{t.hotkeys.doubleClick}</span>
              <span className="tag">{t.hotkeys.fixed}</span>
            </li>
          </ul>
        </div>
        <footer className="add-package__foot">
          <button type="button" className="button" disabled={sending || Object.keys(own).length === 0} onClick={() => save({})}>
            {t.hotkeys.resetAll}
          </button>
          <span className="add-package__spacer" />
          <button type="button" className="button button--primary" onClick={onClose}>
            {t.common.close}
          </button>
        </footer>
      </div>
    </dialog>
  )
}

function refusalText({ combo, refusal }: Refused, mac: boolean): string {
  if (refusal.kind === 'taken') return t.hotkeys.refusal.taken(t.hotkeys.actions[refusal.action])
  if (refusal.kind === 'reserved') return t.hotkeys.refusal.reserved(formatCombo(combo, mac))
  if (refusal.kind === 'field') return t.hotkeys.refusal.field
  return t.hotkeys.refusal.bare
}
