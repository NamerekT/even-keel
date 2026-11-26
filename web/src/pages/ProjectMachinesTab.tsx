import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { EvenKeelState, PoolMachine, ProjectPool } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machinePath } from '../machineColor.js'
import { severalMachines } from '../machineView.js'
import { CommandBlock } from '../ui/blocks.js'
import { Loading } from '../ui/Loader.js'
import { MachineMark } from '../ui/MachineIcon.js'
import { Tipped } from '../ui/Tipped.js'
import { BranchDriftBand } from './BranchField.js'
import { ConnectMachineDialog } from './ConnectMachine.js'
import { JobWindow } from './JobWindow.js'
import { cappedWidth, widthMaxOf } from './poolWidth.js'
import type { PanelFields } from './projectSettingsFields.js'
import { Field, fieldId, Section, Switch, SwitchField, wholeOf } from './settingsParts.js'
import { useVocabularies } from './useVocabularies.js'
import './projectMachines.css'

/** The section "Machines" is shown only where the hub has a machine elsewhere: with one, there is nothing to pick. */
export const poolShown = (state: EvenKeelState | null): boolean => severalMachines(state)

/** One fact of a machine's row: the caption over the value (BTN-1553). */
function PoolFact({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="pool__fact">
      <dt className="ui-label">
        {tip === undefined ? (
          label
        ) : (
          <Tipped tip={tip} inline align="start">
            <span>{label}</span>
          </Tipped>
        )}
      </dt>
      {children}
    </div>
  )
}

/**
 * A machine's commands after a green main as a fact of its row (BTN-1553): its own ones a command block each; the
 * project's ones only named, the same for every machine; `off` — the machine turned them off (BTN-1597).
 */
export function AfterGreen({ commands, own, off = false }: { commands: string[]; own: boolean; off?: boolean }) {
  return (
    <PoolFact label={t.pool.afterGreen} tip={off ? t.pool.afterGreenOffTip : own ? t.pool.afterGreenOwn : t.pool.afterGreenProject}>
      {off || !own ? (
        <dd className="pool__muted">{off ? t.pool.afterGreenOff : t.pool.afterGreenProjects}</dd>
      ) : (
        <dd className="pool__commands">
          {commands.map((command, index) => (
            <CommandBlock key={index} command={command} />
          ))}
        </dd>
      )}
    </PoolFact>
  )
}

/** The project's pool, read again whenever a machine joins, connects or goes away, and after `reload`; `null` while read. */
export function usePool(project: string): { pool: ProjectPool | null; reload: () => void } {
  const { read, onMachines } = useLive()
  const [pool, setPool] = useState<ProjectPool | null>(null)
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    let live = true
    const load = () => void read<ProjectPool>('machines/pool', { project }).then((next) => live && setPool(next), () => live && setPool((last) => last ?? { machines: [], others: [], servers: [] }))
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
  const { text, on, edit, marks, errorOf, notes, number } = fields
  const { pool, reload } = usePool(project)
  const widthMax = widthMaxOf(pool)
  // The switch is the tracker's to offer: one that keeps no components has nothing to split the lanes by.
  const { vocabularies } = useVocabularies([project])
  const components = vocabularies.some((each) => (each.components?.length ?? 0) > 0) || on('componentLanes')
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
            {pool.machines.flatMap((machine) => {
              const drift = state?.machineDrift?.[project]?.[machine.id]
              return drift === undefined ? [] : [<BranchDriftBand key={`drift:${machine.id}`} project={project} drift={drift} machine={machine.id} lead={machine.name} />]
            })}
            {pool.machines.length > 0 && (
              <ul className="pool">
                {pool.machines.map((machine) => (
                  <li key={machine.id} className="pool__row">
                    <div className="pool__head">
                      <span className={`pool__dot${machine.online ? ' pool__dot--online' : ''}`} aria-hidden="true" />
                      <span className="pool__name">
                        <Link to={machinePath(machine.id)} className="pool__link">
                          <MachineMark id={machine.id} />
                          <span className="pool__label">{machine.name}</span>
                        </Link>
                        {machine.own && <span className="tag">{t.pool.own}</span>}
                        {!machine.online && <span className="pool__offline">{t.pool.offline}</span>}
                        {slot > 0 && (
                          <Tipped tip={t.pool.slotsTip} inline>
                            <span className="tag">{t.pool.slots(slot)}</span>
                          </Tipped>
                        )}
                      </span>
                      <Switch checked={machine.enabled} disabled={sending} label={t.pool.enable(machine.name)} onChange={(on) => void enable(machine, on)} />
                    </div>
                    <dl className="pool__facts">
                      <PoolFact label={t.pool.folder}>
                        <dd>
                          <Tipped tip={machine.folder} align="start" className="pool__folder">
                            <bdi dir="ltr">{machine.folder}</bdi>
                          </Tipped>
                        </dd>
                      </PoolFact>
                      {machine.settings.afterGreenOff === true ? (
                        <AfterGreen commands={[]} own off />
                      ) : (
                        machine.afterGreen.length > 0 && <AfterGreen commands={machine.afterGreen} own={machine.settings.afterGreen !== undefined} />
                      )}
                    </dl>
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
        <Field
          className={marks.box('width')}
          label={t.pool.width}
          hint={widthMax === undefined ? t.pool.widthHint : `${t.pool.widthHint} ${t.pool.widthMax(widthMax)}`}
          htmlFor={fieldId('width')}
          mark={marks.note('width')}
          width="number"
          control={number('width', text('width'), wholeOf(text('width'), 1) === undefined || errorOf('width') !== null, (value) => edit('width', cappedWidth(value, widthMax)))}
          error={errorOf('width')}
        />
        {components && (
          <SwitchField
            className={marks.box('componentLanes')}
            label={t.pool.componentLanes}
            hint={t.pool.componentLanesHint}
            checked={on('componentLanes')}
            mark={marks.note('componentLanes')}
            onChange={(checked) => edit('componentLanes', checked)}
          >
            {notes('componentLanes')}
          </SwitchField>
        )}
      </Section>
      {connecting && pool !== null && (
        <ConnectMachineDialog
          project={project}
          others={pool.others}
          pooled={pool.machines}
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
