import { useEffect, useState } from 'react'
import type { EvenKeelState, PoolMachine, ProjectPool } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { ConnectMachineDialog } from './ConnectMachine.js'
import { JobWindow } from './JobWindow.js'
import type { PanelFields } from './projectSettingsFields.js'
import { fieldId, Row, Section, Switch, wholeOf } from './settingsParts.js'
import './projectMachines.css'

/** The section "Machines" is shown only where the hub has a machine elsewhere: with one, there is nothing to pick. */
export const poolShown = (state: EvenKeelState | null): boolean => Object.keys(state?.machineNames ?? {}).length > 1

/** The project's pool, read again whenever a machine joins, connects or goes away, and after `reload`; `null` while read. */
function usePool(project: string): { pool: ProjectPool | null; reload: () => void } {
  const { read, onMachines } = useLive()
  const [pool, setPool] = useState<ProjectPool | null>(null)
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    let live = true
    const load = () => void read<ProjectPool>('machines/pool', { project }).then((next) => live && setPool(next), () => live && setPool((last) => last ?? { machines: [], others: [] }))
    load()
    const off = onMachines(load)
    return () => {
      live = false
      off()
    }
  }, [project, asked])
  return { pool, reload: () => setAsked((count) => count + 1) }
}

/** The tab "Machines" of the project settings (BTN-1271): the pool with each machine's switch, the width, "Connect". */
export function ProjectMachinesTab({ fields, project, slot, state }: { fields: PanelFields; project: string; slot: number; state: EvenKeelState | null }) {
  const { text, edit, marks, errorOf, number } = fields
  const { pool, reload } = usePool(project)
  const { send, sending } = useCommand()
  const [connecting, setConnecting] = useState(false)
  const job = state?.jobs?.find((each) => each.kind === 'machine' && each.project === project)
  const done = job?.done === true
  // A finished connection changed the pool: read it again.
  useEffect(() => {
    if (done) reload()
  }, [done])

  const enable = async (machine: PoolMachine, enabled: boolean) => {
    if (await send('machines/enable', { project, machine: machine.id, enabled })) reload()
  }
  return (
    <>
      <Section title={t.pool.title} hint={t.pool.hint}>
        <Loading busy={pool === null} label={t.pool.reading} fit="block">
          {pool !== null && (
          <>
            {pool.machines.length === 0 && <p className="pool__empty">{t.pool.empty}</p>}
            {pool.machines.length > 0 && (
              <ul className="pool">
                {pool.machines.map((machine) => (
                  <li key={machine.id} className="pool__row">
                    <span className={`pool__dot${machine.online ? ' pool__dot--online' : ''}`} aria-hidden="true" />
                    <span className="pool__main">
                      <span className="pool__name">
                        {machine.name}
                        {machine.own && <span className="tag">{t.pool.own}</span>}
                        {!machine.online && <span className="pool__offline">{t.pool.offline}</span>}
                      </span>
                      <Tipped tip={t.pool.folderTip} inline align="start">
                        <bdi className="pool__folder" dir="ltr">
                          {machine.folder}
                        </bdi>
                      </Tipped>
                    </span>
                    {slot > 0 && (
                      <Tipped tip={t.pool.slotsTip} inline>
                        <span className="tag">{t.pool.slots(slot)}</span>
                      </Tipped>
                    )}
                    <Switch checked={machine.enabled} disabled={sending} label={t.pool.enable(machine.name)} onChange={(on) => void enable(machine, on)} />
                  </li>
                ))}
              </ul>
            )}
            {pool.others.length > 0 && (
              <div className="pool__actions">
                <Tipped tip={t.pool.connectHint} inline align="start">
                  <button type="button" className="button" onClick={() => setConnecting(true)}>
                    {t.pool.connect}
                  </button>
                </Tipped>
              </div>
            )}
          </>
          )}
        </Loading>
        <Row
          className={marks.box('width')}
          label={t.pool.width}
          hint={t.pool.widthHint}
          htmlFor={fieldId('width')}
          mark={marks.note('width')}
          control={number('width', text('width'), wholeOf(text('width'), 1) === undefined || errorOf('width') !== null, (value) => edit('width', value))}
          error={errorOf('width')}
        />
      </Section>
      {connecting && pool !== null && (
        <ConnectMachineDialog
          project={project}
          others={pool.others}
          onClose={() => setConnecting(false)}
          onStarted={() => {
            setConnecting(false)
            reload()
          }}
        />
      )}
      {job !== undefined && (
        <JobWindow
          job={job}
          title={t.pool.window}
          stepLabel={(id) => t.creation.window.steps[id] ?? id}
          done={{ label: t.pool.done, onDone: () => void send('job/close', { id: job.id }) }}
          undoNote={t.pool.undoable}
        />
      )}
    </>
  )
}
