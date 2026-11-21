import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { EvenKeelState, MachineInvite, MachineView } from '../../../src/state.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { formatLineTime } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { MACHINE_PALETTE, nextColor } from '../../../src/link/colors.js'
import { addMachineOf, joinedMachine, takenColors, withAddMachine } from '../machineAdd.js'
import { machineArrival } from '../machineArrival.js'
import { HubAddressField } from '../pages/HubAddressField.js'
import { HelpTip, Switch } from '../pages/settingsParts.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CommandBlock } from '../ui/blocks.js'
import { CloseIcon, ServerIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { useHeightGlide } from '../ui/useHeightGlide.js'
import { MachineJoined } from './MachineJoined.js'
import { useNow } from './useNow.js'
import '../tools/addPackage.css'
import '../pages/settings.css'
import './addMachine.css'

/** Whether this browser issued its last string for a hub behind a proxy that ends TLS (BTN-1286). */
const PROXIED_KEY = 'even-keel.machines.proxied'

function storedProxied(): boolean {
  try {
    return localStorage.getItem(PROXIED_KEY) === 'true'
  } catch {
    return false
  }
}

function keepProxied(proxied: boolean): void {
  try {
    localStorage.setItem(PROXIED_KEY, String(proxied))
  } catch {
    // A browser that keeps no storage asks again in the next window.
  }
}

/** Opens the window that adds a machine over the current page: at the address step, or at a machine that joined. */
export function useOpenAddMachine(): (at?: string) => void {
  const location = useLocation()
  const navigate = useNavigate()
  return (at = 'new') => void navigate({ pathname: location.pathname, search: withAddMachine(location.search, at) })
}

/**
 * Adding a machine (BTN-1056): the hub's address and the machine's name, the one install command, the wait for the
 * machine, then what it reported, its projects and its accounts. The machine calls the hub; the hub only issues.
 */
export function AddMachineDialog({ state }: { state: EvenKeelState }) {
  const at = addMachineOf(new URLSearchParams(useLocation().search))
  return at === null ? null : <MachineDialog state={state} at={at} />
}

/** The machines elsewhere, read again whenever one joins, connects or goes away; `null` while read. */
export function useMachines(): MachineView[] | null {
  const { read, onMachines } = useLive()
  const [machines, setMachines] = useState<MachineView[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () => void read<MachineView[]>('machines/list', {}).then((list) => live && setMachines(list), () => live && setMachines((last) => last ?? []))
    load()
    const off = onMachines(load)
    return () => {
      live = false
      off()
    }
  }, [])
  return machines
}

function MachineDialog({ state, at }: { state: EvenKeelState; at: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const heading = useId()
  const machines = useMachines()
  const [invite, setInvite] = useState<MachineInvite | null>(null)
  const awaited = at === 'new' ? invite?.machine : at
  const joined = machines === null || awaited === undefined ? undefined : joinedMachine(machines, awaited)
  useHeightGlide(frame, joined !== undefined ? 'joined' : invite !== null ? 'command' : 'address')

  useLayoutEffect(() => {
    if (dialog.current?.open !== false) return
    dialog.current.showModal()
    dialog.current.querySelector<HTMLElement>('.add-package__body input')?.focus()
  }, [])

  // The machine joined while the window waited: the address names it, so a reload stays at its step.
  useEffect(() => {
    if (joined === undefined) return
    if (machineArrival.get()?.machine === joined.id) machineArrival.set(null)
    if (at === 'new') void navigate({ pathname: location.pathname, search: withAddMachine(location.search, joined.id) }, { replace: true })
  }, [joined?.id])

  const close = () => {
    if (at === 'new' && invite !== null && joined === undefined) machineArrival.set({ machine: invite.machine, expiresAt: invite.expiresAt })
    void navigate({ pathname: location.pathname, search: withAddMachine(location.search, null) }, { replace: true })
  }
  const backdrop = useBackdropClose(dialog, close)

  return (
    <dialog
      ref={dialog}
      className="add-package add-machine"
      aria-labelledby={heading}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        close()
      }}
      {...backdrop}
    >
      <div ref={frame} className="add-package__frame add-machine__frame">
        <header className="add-package__head">
          <span className="add-machine__icon" aria-hidden="true">
            <ServerIcon />
          </span>
          <h2 id={heading} className="add-package__title">
            {t.machines.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={close}>
            <CloseIcon />
          </button>
        </header>
        {joined !== undefined ? (
          <MachineJoined state={state} machine={joined} onClose={close} />
        ) : at !== 'new' ? (
          machines === null ? (
            <div className="add-package__body">
              <p className="add-machine__wait" role="status">
                <span className="add-machine__spinner" aria-hidden="true" />
                {t.machines.waiting}
              </p>
            </div>
          ) : (
            <>
              <div className="add-package__body">
                <p className="add-package__empty">{t.machines.gone}</p>
              </div>
              <footer className="add-package__foot">
                <span className="add-package__spacer" />
                <button type="button" className="button" onClick={close}>
                  {t.machines.close}
                </button>
                <button type="button" className="button button--primary" onClick={() => void navigate({ pathname: location.pathname, search: withAddMachine(location.search, 'new') }, { replace: true })}>
                  {t.machines.add}
                </button>
              </footer>
            </>
          )
        ) : (
          <InviteSteps state={state} taken={takenColors(state, machines ?? [])} invite={invite} onInvite={setInvite} onClose={close} />
        )}
      </div>
    </dialog>
  )
}

interface InviteStepsProps {
  state: EvenKeelState
  /** The colours the hub's machines have: the window offers the palette's next free one. */
  taken: string[]
  invite: MachineInvite | null
  onInvite: (invite: MachineInvite) => void
  onClose: () => void
}

/**
 * The address, the name and the colour, then the command and the wait under them: the fields stay, "Issue again"
 * takes them anew.
 */
function InviteSteps({ state, taken, invite, onInvite, onClose }: InviteStepsProps) {
  const { query } = useLive()
  const addressId = useId()
  const nameId = useId()
  const colorId = useId()
  const [address, setAddress] = useState(state.config.shared.machinesAddress ?? '')
  const [proxied, setProxied] = useState(storedProxied)
  const [name, setName] = useState('')
  // Until one is pressed, the palette's next free colour: the machines read later may change which it is.
  const [picked, setPicked] = useState<string | null>(null)
  const color = picked ?? nextColor(taken)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const blank = address.trim() === ''

  const issue = async () => {
    setSending(true)
    setFailure(null)
    try {
      onInvite(await query<MachineInvite>('machines/invite', { name: name.trim(), address: address.trim(), color, proxied }))
      keepProxied(proxied)
    } catch (error) {
      setFailure(noticeOf(error))
    } finally {
      setSending(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!blank && !sending && invite === null) void issue()
  }

  return (
    <form className="add-package__form" onSubmit={submit}>
      <div className="add-package__body">
        <div className="add-package__field">
          <label className="add-package__label" htmlFor={addressId}>
            {t.machines.address}
          </label>
          <HubAddressField id={addressId} value={address} invalid={failure?.code === 'config.machinesAddress'} placeholder={t.machines.addressNone} onChange={setAddress} />
          <p className="add-package__note">{t.machines.addressHint}</p>
          <span className="add-machine__proxy">
            <label className="add-machine__proxy-label">
              <Switch checked={proxied} disabled={sending} label={t.machines.proxied} onChange={setProxied} />
              {t.machines.proxied}
            </label>
            <HelpTip text={t.machines.proxiedHint} align="start" />
          </span>
        </div>
        <div className="add-package__field">
          <label className="add-package__label" htmlFor={nameId}>
            {t.machines.name}
          </label>
          <input id={nameId} className="add-package__input" value={name} maxLength={60} placeholder={t.machines.namePlaceholder} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="add-package__field">
          <span className="add-package__label" id={colorId}>
            {t.machines.color}
          </span>
          <span className="add-machine__colors" role="group" aria-labelledby={colorId}>
            {MACHINE_PALETTE.map((each) => (
              <button
                key={each}
                type="button"
                className="add-machine__swatch"
                style={{ background: each }}
                aria-label={t.machinePage.swatch(each)}
                aria-pressed={each === color}
                onClick={() => setPicked(each)}
              />
            ))}
          </span>
          <p className="add-package__note">{t.machines.colorHint}</p>
        </div>
        {invite !== null && <CommandPart invite={invite} sending={sending} blank={blank} onAgain={() => void issue()} />}
      </div>
      {failure !== null && (
        <p role="alert" className="notice notice--error add-package__failure">
          {say(failure)}
        </p>
      )}
      <footer className="add-package__foot">
        {invite === null ? (
          <>
            <span className="add-package__spacer" />
            <button type="button" className="button" onClick={onClose}>
              {t.machines.cancel}
            </button>
            <button type="submit" className="button button--primary" disabled={blank || sending} aria-busy={sending || undefined}>
              {t.machines.issue}
            </button>
          </>
        ) : (
          <>
            <span className="add-package__note add-machine__foot-note">{t.machines.closeNote}</span>
            <span className="add-package__spacer" />
            <button type="button" className="button" onClick={onClose}>
              {t.machines.close}
            </button>
          </>
        )}
      </footer>
    </form>
  )
}

/** The one command for every system, until when it holds, and the wait for the machine that runs it. */
function CommandPart({ invite, sending, blank, onAgain }: { invite: MachineInvite; sending: boolean; blank: boolean; onAgain: () => void }) {
  const now = useNow(5_000)
  const expired = now.getTime() > invite.expiresAt
  return (
    <>
      <div key={invite.machine} className="add-package__field add-machine__appear">
        <span className="add-package__label">{t.machines.run}</span>
        <CommandBlock command={invite.command} copyLabel={t.machines.copy} className="add-machine__command" />
        <p className="add-machine__meta">
          <span>{t.machines.until(formatLineTime(new Date(invite.expiresAt).toISOString()))}</span>
          <Tipped tip={t.machines.againHint} inline align="start">
            <button type="button" className="link-button" disabled={sending || blank} onClick={onAgain}>
              {t.machines.again}
            </button>
          </Tipped>
        </p>
        <p className="add-package__note">{t.machines.needs}</p>
      </div>
      <p className={`add-machine__wait${expired ? ' add-machine__wait--expired' : ''}`} role="status">
        {!expired && <span className="add-machine__spinner" aria-hidden="true" />}
        {expired ? t.machines.expired : t.machines.waiting}
      </p>
    </>
  )
}
