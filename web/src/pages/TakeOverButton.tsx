import { useState } from 'react'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'

interface TakeOverProps {
  project: string
  /** The machine whose mark holds the folder, as its refusal named it, and its name. */
  owner: string
  name: string
  /** The machine that takes the folder; none — the hub's own. */
  machine?: string
  /** Resume the project's chain once the folder is taken: the button under the chain's pause. */
  resume?: boolean
  className?: string
}

/**
 * "Take the folder over" behind a confirmation that names the machine losing it (BTN-1261, `docs/machines.md`, "The
 * folder's mark"): the machine is to be gone, or it stops working in the folder.
 */
export function TakeOverButton({ className = 'button button--small notice-fix', ...props }: TakeOverProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        {t.fix.takeOver}
      </button>
      {confirming && <TakeOverConfirm {...props} onClose={() => setConfirming(false)} />}
    </>
  )
}

/** Its own command, so a refusal shown in one opening (`machines.notTaken`) is gone in the next. */
function TakeOverConfirm({ project, owner, name, machine, resume = false, onClose }: Omit<TakeOverProps, 'className'> & { onClose: () => void }) {
  const label = useProjectLabel()
  const { send, sending, failure } = useCommand()
  // Taken, but the chain refused to resume: a second press only resumes, the takeover would be refused `machines.notTaken`.
  const [taken, setTaken] = useState(false)

  const take = async () => {
    if (!taken && !(await send('machines/takeOver', { ...(machine === undefined ? {} : { machine }), project, owner }))) return
    setTaken(true)
    if (!resume || (await send('chain/resume', { project }))) onClose()
  }

  return (
    <ConfirmDialog
      title={t.fix.takeOverTitle}
      question={t.fix.takeOverQuestion(label(project), name)}
      confirm={t.fix.takeOver}
      cancel={t.common.cancel}
      busy={sending}
      failure={failure !== null ? say(failure) : undefined}
      onConfirm={() => void take()}
      onClose={onClose}
    />
  )
}
