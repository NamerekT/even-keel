import { useState } from 'react'
import { useNavigate } from 'react-router'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'

/** "Remove project" behind a confirmation; the service refuses while the chain, a session or a kept folder still holds it. */
export function ProjectRemove({ project }: { project: string }) {
  const [confirming, setConfirming] = useState(false)
  const { send, sending, failure } = useCommand()
  const navigate = useNavigate()

  const remove = async () => {
    if (await send('project/remove', { project })) void navigate('/')
  }

  return (
    <section className="settings__field project-remove">
      <span className="settings__label">{t.wizard.remove}</span>
      <p className="settings__hint">{t.wizard.removeHint}</p>
      <div className="account__actions">
        {confirming ? (
          <>
            <span className="accounts__confirm">{t.wizard.removeQuestion(project)}</span>
            <button type="button" className="button button--small button--danger" disabled={sending} onClick={() => void remove()}>
              {t.common.remove}
            </button>
            <button type="button" className="button button--small" disabled={sending} onClick={() => setConfirming(false)}>
              {t.common.cancel}
            </button>
          </>
        ) : (
          <button type="button" className="button button--small" onClick={() => setConfirming(true)}>
            {t.wizard.remove}
          </button>
        )}
      </div>
      {failure !== null && <p className="notice notice--error project-remove__failure">{say(failure)}</p>}
    </section>
  )
}
