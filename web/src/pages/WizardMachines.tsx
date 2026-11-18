import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { noticeOf } from '../../../src/notice/notice.js'
import type { EvenKeelState, FolderProbe, MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useMachines } from '../layout/AddMachineDialog.js'
import { spanOf } from '../layout/MachinePanel.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machineAccounts, osLabel } from '../machineAdd.js'
import { machineLogin } from '../machineSignIn.js'
import { Band } from '../ui/blocks.js'
import { AddOnButton } from './FixButtons.js'
import type { WizardFields } from './projectWizard.js'
import { FieldHead } from './settingsParts.js'
import { Status } from './TrackerFields.js'
import { hubOn, machineFolder, NEW_PICK, pickedMachines, rowState, separatorOf, wizardMachines, type MachinePick, type WizardMachine } from './machinePicks.js'
import './wizardMachines.css'

const REREAD_MS = 15_000
const PROBE_DELAY_MS = 500

/** The hub's machines for the block "Machines" (BTN-1297): the header's cards with each machine's report, read again as machines come and go. */
export function useWizardMachines(state: EvenKeelState): WizardMachine[] {
  const { read, onMachines } = useLive()
  const views = useMachines()
  const [cards, setCards] = useState<MachineCard[]>([])
  useEffect(() => {
    let live = true
    const load = () => void read<MachineCard[]>('machines/cards', {}).then((next) => live && setCards(next), () => {})
    load()
    const off = onMachines(load)
    const timer = setInterval(load, REREAD_MS)
    return () => {
      live = false
      off()
      clearInterval(timer)
    }
    // `useLive` gives new functions each render; the source behind them is one.
  }, [])
  return useMemo(() => wizardMachines(cards, views ?? [], state.platform), [cards, views, state.platform])
}

/**
 * What each ticked machine's folder is now (BTN-1297), asked of the machine a moment after its folder or the remote
 * stops changing; a machine absent from the answer is being asked.
 */
export function useFolderProbes(fields: WizardFields, machines: WizardMachine[], remote: string | null, hubName: string): Record<string, FolderProbe | undefined> {
  const { read } = useLive()
  const [answers, setAnswers] = useState<Record<string, FolderProbe>>({})
  const asks = pickedMachines(fields, machines, remote).flatMap((machine) => {
    const folder = machineFolder(fields.machines[machine.id]!, machine, hubName)
    return folder === null || remote === null ? [] : [{ machine: machine.id, folder, remote, key: JSON.stringify([machine.id, folder, remote]) }]
  })
  const asked = JSON.stringify(asks.map((each) => each.key))
  useEffect(() => {
    const fresh = asks.filter((each) => answers[each.key] === undefined)
    if (fresh.length === 0) return
    let live = true
    const timer = setTimeout(() => {
      for (const each of fresh) {
        read<FolderProbe>('machines/folder', { machine: each.machine, folder: each.folder, remote: each.remote }).then(
          (probe) => live && setAnswers((before) => ({ ...before, [each.key]: probe })),
          (error: unknown) => live && setAnswers((before) => ({ ...before, [each.key]: { state: 'taken', notice: noticeOf(error) } })),
        )
      }
    }, PROBE_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // The asks' keys stand for the asks.
  }, [asked])
  return Object.fromEntries(asks.map((each) => [each.machine, answers[each.key]]))
}

export interface MachinesBlockProps {
  state: EvenKeelState
  fields: WizardFields
  set: (change: Partial<WizardFields>) => void
  machines: WizardMachine[]
  remote: string | null
  /** The hub's folder name, a machine's folder name while its own is blank. */
  hubName: string
  probes: Record<string, FolderProbe | undefined>
  /** The hub's row under its head: the folder line of a clone, or the path the field above names. */
  hubFolder: ReactNode
  /** The one field names a new folder (no remote yet), not a checkout without one. */
  newFolder: boolean
}

const agentName = (agent: string): string => t.account.agents[agent as keyof typeof t.account.agents] ?? agent

/** The system's name alone, as a label: "Linux", not its release. */
const systemOf = (os: string): string => osLabel(os.split(' ')[0] ?? os)

/**
 * The wizard's block "Machines" (BTN-1297): every machine of the hub with a box, the ticked ones open with their folder
 * and what is there now. Without a remote only the hub takes the project; a machine off the link is connected later
 * in the project's "Machines" tab.
 */
export function MachinesBlock({ state, fields, set, machines, remote, hubName, probes, hubFolder, newFolder }: MachinesBlockProps) {
  const words = t.pool.wizard
  const now = useNow(60_000)
  const pickOf = (id: string): MachinePick => fields.machines[id] ?? NEW_PICK
  const change = (id: string, patch: Partial<MachinePick>) => set({ machines: { ...fields.machines, [id]: { ...pickOf(id), ...patch } } })
  return (
    <div className="settings__field wizard-machines">
      <FieldHead label={words.title} hint={words.hint} />
      {remote === null && <Band tone="warn">{newFolder ? words.remoteNew : words.remoteNone}</Band>}
      <ul className="wizard-machines__list">
        {machines.map((machine) => {
          const why = rowState(machine, remote)
          const pick = pickOf(machine.id)
          const on = machine.own ? hubOn(fields, remote) : pick.on && why === 'open'
          const locked = why !== 'open' || (machine.own && remote === null)
          const style = { '--machine': machine.color } as CSSProperties
          return (
            <li key={machine.id} className={`wizard-machines__machine${why === 'open' ? '' : ' wizard-machines__machine--off'}`}>
              <label className="wizard-machines__head">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  aria-label={words.tick(machine.name)}
                  onChange={(event) => (machine.own ? set({ hubOff: !event.target.checked }) : change(machine.id, { on: event.target.checked }))}
                />
                <span className="wizard-machines__dot" style={style} aria-hidden="true" />
                <span className="wizard-machines__name">{machine.name}</span>
                {machine.own && <span className="tag">{words.own}</span>}
                {machine.os !== null && <span className="tag">{systemOf(machine.os)}</span>}
                {machine.online ? (
                  <span className="chip wizard-machines__online">{words.online}</span>
                ) : (
                  <span className="wizard-machines__muted">
                    {machine.offlineSince === null ? t.machinePanel.offlineUnknown : t.machinePanel.offline(spanOf(now.getTime() - machine.offlineSince))}
                  </span>
                )}
                {machine.online && machine.agents.map((agent) => <span key={agent} className="tag">{agentName(agent)}</span>)}
                {machine.online && machine.agents.length === 0 && <span className="chip chip--paused">{words.noAgent}</span>}
                {why !== 'open' && <span className="wizard-machines__why">{why === 'offline' ? words.offlineNote : why === 'noRemote' ? words.noRemote : words.noRoot}</span>}
              </label>
              {on && machine.own && <div className="wizard-machines__body">{hubFolder}</div>}
              {on && !machine.own && (
                <div className="wizard-machines__body">
                  <MachineFolder machine={machine} pick={pick} hubName={hubName} probe={probes[machine.id]} onChange={(patch) => change(machine.id, patch)} />
                  {machine.agents.length === 0 && <SignInBand state={state} machine={machine} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A ticked machine's folder: its folder of projects and a name in it, or a full path behind "another folder…", and what is there. */
function MachineFolder({ machine, pick, hubName, probe, onChange }: { machine: WizardMachine; pick: MachinePick; hubName: string; probe: FolderProbe | undefined; onChange: (patch: Partial<MachinePick>) => void }) {
  const words = t.pool.wizard
  const root = machine.root ?? ''
  const separator = separatorOf(root)
  const folder = machineFolder(pick, machine, hubName)
  return (
    <>
      {pick.other ? (
        <input
          className="settings__text settings__text--mono"
          aria-label={words.pathOf(machine.name)}
          autoComplete="off"
          spellCheck={false}
          value={pick.path}
          placeholder={words.pathPlaceholder}
          aria-invalid={probe?.state === 'taken' || undefined}
          onChange={(event) => onChange({ path: event.target.value })}
        />
      ) : (
        <span className="project-add__folder">
          <span className="project-add__dir" title={root}>
            <bdi dir="ltr">
              {root.replace(/[\\/]+$/, '')}
              {separator}
            </bdi>
          </span>
          <input
            className="settings__text settings__text--mono project-add__name"
            aria-label={words.folderOf(machine.name)}
            autoComplete="off"
            spellCheck={false}
            value={pick.folder}
            placeholder={hubName}
            aria-invalid={probe?.state === 'taken' || undefined}
            onChange={(event) => onChange({ folder: event.target.value })}
          />
        </span>
      )}
      <button type="button" className="link-button project-add__other" onClick={() => onChange({ other: !pick.other })}>
        {pick.other ? t.creation.own : t.creation.other}
      </button>
      {folder !== null && (probe === undefined ? <span className="settings__hint">{t.wizard.checking}</span> : <ProbeLine probe={probe} />)}
    </>
  )
}

function ProbeLine({ probe }: { probe: FolderProbe }) {
  if (probe.state === 'taken') return <Status>{say(probe.notice)}</Status>
  return <Status ok>{t.pool.wizard.states[probe.state]}</Status>
}

/**
 * A machine with no agent signed in (BTN-1297): the project connects, its tasks wait. "Sign in on X" signs a hub
 * account in there as its row on the accounts page does (`machines/login`, followed by `MachineLoginDialog`); several
 * accounts — a pick first; none to carry — "Add account" with the machine picked.
 */
function SignInBand({ state, machine }: { state: EvenKeelState; machine: WizardMachine }) {
  const words = t.pool.wizard
  const { send, sending } = useCommand()
  const [picking, setPicking] = useState(false)
  const signIn = state.machineSignIns?.find((each) => each.machine === machine.id)
  const rows = signIn === undefined ? [] : machineAccounts(state.account.accounts, signIn).flatMap((row) => (row.gap === null || row.gap.noCli ? [] : [{ ...row, gap: row.gap }]))
  const busy = sending || machineLogin(state.machineSignIns) !== undefined
  const login = (row: (typeof rows)[number]) =>
    void send('machines/login', { machine: machine.id, agent: row.entry.agent, ...(row.gap.account !== undefined && { account: row.gap.account }) })
  const label = words.signIn(machine.name)
  const action =
    rows.length === 0 ? (
      <AddOnButton machine={machine.id} className="button button--small" label={label} disabled={busy} />
    ) : (
      <button type="button" className="button button--small" disabled={busy} aria-expanded={rows.length > 1 ? picking : undefined} onClick={() => (rows.length === 1 ? login(rows[0]!) : setPicking(!picking))}>
        {label}
      </button>
    )
  return (
    <Band tone="warn" action={action} className="wizard-machines__band">
      {words.noAgentNote(machine.name)}
      {picking && rows.length > 1 && (
        <span className="wizard-machines__accounts" role="group" aria-label={words.pickAccount}>
          {rows.map((row) => (
            <button key={`${row.entry.agent} ${row.entry.key}`} type="button" className="button button--small" disabled={busy} onClick={() => login(row)}>
              {row.entry.status?.email ?? row.entry.key} · {agentName(row.entry.agent)}
            </button>
          ))}
        </span>
      )}
    </Band>
  )
}
