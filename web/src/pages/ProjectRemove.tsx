import { useState } from 'react'
import { useNavigate } from 'react-router'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { Section } from './settingsParts.js'

/** "Remove project" in a red card of its own, behind a confirmation window; the service refuses while the chain, a session or a kept folder still holds it. */
export function ProjectRemove({ project }: { project: string }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <Section title={t.wizard.remove} hint={t.wizard.removeHint} danger>
      <div className="account__actions">
        <button type="button" className="button button--small" onClick={() => setConfirming(true)}>
          {t.wizard.remove}
        </button>
      </div>
      {confirming && <RemoveConfirm project={project} onClose={() => setConfirming(false)} />}
    </Section>
  )
}

/** Its own command, so a refusal shown in one opening is gone in the next. */
function RemoveConfirm({ project, onClose }: { project: string; onClose: () => void }) {
  const label = useProjectLabel()
  const { send, sending, failure } = useCommand()
  const navigate = useNavigate()

  const remove = async () => {
    if (await send('project/remove', { project })) void navigate('/')
  }

  return (
    <ConfirmDialog
      title={t.wizard.remove}
      question={t.wizard.removeQuestion(label(project))}
      confirm={t.common.remove}
      cancel={t.common.cancel}
      busy={sending}
      failure={failure !== null ? say(failure) : undefined}
      onConfirm={() => void remove()}
      onClose={onClose}
    />
  )
}
