import { useState } from 'react'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Toast } from '../ui/Toast.js'

/** The last row of the gear menu and the burger's sheet: the installed version, and a newer release when there is one. */
export function VersionRow() {
  const { state } = useLive()
  if (state === null) return null
  const { current, available } = state.updates
  return (
    <div className="gear__version">
      <span>{t.updates.version(current)}</span>
      {available !== null && (
        <a className="gear__update" href={available.url} target="_blank" rel="noreferrer" title={t.updates.availableTitle}>
          {t.updates.available(available.version)}
        </a>
      )}
    </div>
  )
}

/** The toast about a newer release; its buttons are kept by the service, so every device stops showing it. */
export function UpdateToast() {
  const { state } = useLive()
  const { send } = useCommand()
  const [hidden, setHidden] = useState<string | null>(null)
  const updates = state?.updates
  const available = updates?.available ?? null
  if (updates === undefined || !updates.toast || available === null || hidden === available.version) return null

  const hide = (command: string, body?: Record<string, unknown>) => {
    setHidden(available.version)
    void send(command, body).then((done) => {
      if (!done) setHidden(null)
    })
  }
  return (
    <Toast
      source="Even Keel"
      icon="/favicon.svg"
      title={t.updates.toastTitle(available.version)}
      body={t.updates.toastBody(updates.current)}
      href={available.url}
      actions={[
        { label: t.updates.mute, onClick: () => hide('updates/mute') },
        { label: t.updates.close, onClick: () => hide('updates/dismiss', { version: available.version }) },
      ]}
    />
  )
}
