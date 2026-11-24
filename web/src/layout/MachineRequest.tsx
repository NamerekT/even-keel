import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { EvenKeelState, MachineRequest, MachineView } from '../../../src/state.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { formatLineTime } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { joinedMachine, osLabel, shownRequests } from '../machineAdd.js'
import { HelpTip } from '../pages/settingsParts.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Fact, FactList } from '../ui/blocks.js'
import { CloseIcon, ServerIcon } from '../ui/icons.js'
import { useOpenAddMachine } from './AddMachineDialog.js'
import { useNow } from './useNow.js'
import '../tools/addPackage.css'
import './addMachine.css'
import './machineRequest.css'

/**
 * A machine asking to join by the hub's address (BTN-1620), in every open tab: what it reported and the code its
 * terminal shows; "Admit" waits here for the machine and opens "Add a machine" at its projects, "Decline" refuses it.
 */
export function MachineRequestDialog({ state }: { state: EvenKeelState }) {
  const now = useNow(5_000).getTime()
  // Closed without a decision: hidden in this tab, still waiting in the others.
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set())
  // Let in from this tab: the request leaves the state, the same window waits for its machine.
  const [admitted, setAdmitted] = useState<{ request: string; machine: string } | null>(null)
  const shown = shownRequests(state.machineRequests, now, aside)
  const request = shown[0]
  if (admitted !== null) return <RequestWindow key={admitted.request} admitted={admitted.machine} more={0} onDone={() => setAdmitted(null)} onAdmitted={() => {}} />
  if (request === undefined) return null
  return (
    <RequestWindow
      key={request.id}
      request={request}
      more={shown.length - 1}
      onDone={() => setAside((current) => new Set([...current, request.id]))}
      onAdmitted={(machine) => setAdmitted({ request: request.id, machine })}
    />
  )
}

interface RequestWindowProps {
  request?: MachineRequest
  /** The id of the machine let in from this tab, waited for until it joins. */
  admitted?: string
  /** How many more requests wait behind this one. */
  more: number
  onDone: () => void
  onAdmitted: (machine: string) => void
}

function RequestWindow({ request, admitted, more, onDone, onAdmitted }: RequestWindowProps) {
  const { query, command } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [sending, setSending] = useState<'admit' | 'decline' | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const backdrop = useBackdropClose(dialog, onDone)

  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const decide = async (how: 'admit' | 'decline') => {
    if (request === undefined) return
    setSending(how)
    setFailure(null)
    try {
      if (how === 'decline') {
        await command('machines/decline', { request: request.id })
        onDone()
      } else onAdmitted((await query<{ machine: string }>('machines/admit', { request: request.id })).machine)
    } catch (error) {
      setFailure(noticeOf(error))
    } finally {
      setSending(null)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="add-package add-machine machine-request"
      aria-labelledby={heading}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onDone()
      }}
      {...backdrop}
    >
      <div className="add-package__frame add-machine__frame">
        <header className="add-package__head">
          <span className="add-machine__icon" aria-hidden="true">
            <ServerIcon />
          </span>
          <h2 id={heading} className="add-package__title">
            {t.machines.requestTitle}
          </h2>
          {more > 0 && (
            <span className="count-badge" aria-label={t.machines.requestMore(more)}>
              +{more}
            </span>
          )}
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onDone}>
            <CloseIcon />
          </button>
        </header>
        {admitted !== undefined ? <AdmittedWait machine={admitted} onDone={onDone} /> : request !== undefined && <RequestFacts request={request} />}
        {failure !== null && (
          <p role="alert" className="notice notice--error add-package__failure">
            {say(failure)}
          </p>
        )}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          {admitted !== undefined ? (
            <button type="button" className="button" onClick={onDone}>
              {t.machines.close}
            </button>
          ) : (
            <>
              <button type="button" className="button" disabled={sending !== null} aria-busy={sending === 'decline' || undefined} onClick={() => void decide('decline')}>
                {t.machines.requestDecline}
              </button>
              <button type="button" className="button button--primary" disabled={sending !== null} aria-busy={sending === 'admit' || undefined} onClick={() => void decide('admit')}>
                {t.machines.requestAdmit}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  )
}

/** What the machine reported and the code to compare with its terminal. */
function RequestFacts({ request }: { request: MachineRequest }) {
  const { about } = request
  const system = [osLabel(about.os), ...(about.container === true ? [t.machines.requestDocker] : [])].join(', ')
  return (
    <div className="add-package__body">
      <FactList>
        <Fact label={t.machines.requestHost}>
          <dd>{about.host}</dd>
        </Fact>
        <Fact label={t.machines.aboutOs}>
          <dd>{system}</dd>
        </Fact>
        <Fact label={t.machines.requestFrom}>
          <dd>{request.from}</dd>
        </Fact>
        <Fact label={t.machines.requestRoot} wide>
          <dd className="machine-request__path">{about.root ?? t.machines.requestRootDefault}</dd>
        </Fact>
      </FactList>
      <div className="machine-request__code-box">
        <span className="machine-request__caption">{t.machines.requestCode}</span>
        <strong className="machine-request__code">{request.code}</strong>
        <span className="machine-request__aside">
          {t.machines.requestCompare}
          <HelpTip text={t.machines.requestCompareHint(formatLineTime(new Date(request.expiresAt).toISOString()))} align="end" />
        </span>
      </div>
    </div>
  )
}

/** The machine let in from this tab: its window "Add a machine" opens at its projects once it joins. */
function AdmittedWait({ machine, onDone }: { machine: string; onDone: () => void }) {
  const { read, onMachines } = useLive()
  const openAdd = useOpenAddMachine()
  useEffect(() => {
    let live = true
    const check = () =>
      void read<MachineView[]>('machines/list', {}).then((list) => {
        if (!live || joinedMachine(list, machine) === undefined) return
        onDone()
        openAdd(machine)
      }, () => {})
    check()
    const off = onMachines(check)
    return () => {
      live = false
      off()
    }
  }, [machine])
  return (
    <div className="add-package__body">
      <p className="add-machine__wait" role="status">
        <span className="add-machine__spinner" aria-hidden="true" />
        {t.machines.requestAdmitted}
      </p>
    </div>
  )
}
