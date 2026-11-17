import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machinePath } from '../machineColor.js'
import { packagesPath } from '../tools/packageGroups.js'
import { Loading } from '../ui/Loader.js'
import { ConnectMachineDialog } from './ConnectMachine.js'
import { JobWindow } from './JobWindow.js'
import { MachineOwnValues } from './MachineOwnValues.js'
import { usePool } from './ProjectMachinesTab.js'
import { Row, Section, Switch } from './settingsParts.js'
import './projectMachines.css'

const ROW = 'settings__field'

/**
 * The settings tab in a machine's view (BTN-1279): the machine in the project — its folder there, whether it takes the
 * project's tasks, whether the project's packages are ready on it. The switch applies at once, as on the tab "Machines".
 */
export function ProjectMachineSettings({ project, card, onShared }: { project: string; card: MachineCard; onShared: () => void }) {
  const view = t.machinePanel.view
  const { pool, reload } = usePool(project)
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const [connecting, setConnecting] = useState(false)
  const row = pool?.machines.find((each) => each.id === card.id)
  const other = pool?.others.filter((each) => each.id === card.id) ?? []
  const blocked = card.projects.some((each) => each.project === project && each.packagesBlocked)
  const job = state?.jobs?.find((each) => each.kind === 'machine' && each.project === project)
  const done = job?.done === true
  // A finished connection put the machine into the pool: read it again.
  useEffect(() => {
    if (done) reload()
  }, [done])
  const enable = async (enabled: boolean) => {
    if (await send('machines/enable', { project, machine: card.id, enabled })) reload()
  }
  return (
    <>
      <Section title={view.settingsTitle(card.name)} hint={view.settingsHint}>
        <Loading busy={pool === null} label={view.reading} fit="block">
          {pool !== null && row === undefined && (
            <div className="pool__outside">
              <p className="pool__empty">{view.outside}</p>
              {other.length > 0 && (
                <button type="button" className="button button--small" onClick={() => setConnecting(true)}>
                  {t.pool.connect}
                </button>
              )}
            </div>
          )}
          {row !== undefined && (
            <>
              <Row
                className={ROW}
                label={view.folder}
                hint={view.folderHint}
                control={
                  <bdi className="pool__folder" dir="ltr">
                    {row.folder}
                  </bdi>
                }
              />
              <Row className={ROW} label={view.pool} hint={view.poolHint} control={<Switch checked={row.enabled} disabled={sending} label={t.pool.enable(card.name)} onChange={(on) => void enable(on)} />} />
              <Row
                className={ROW}
                label={view.packages}
                hint={view.packagesHint}
                control={
                  <span className="pool__packages">
                    <span className={blocked ? 'pool__packages-state pool__packages-state--blocked' : 'pool__packages-state'}>{blocked ? view.packagesBlocked : view.packagesReady}</span>
                    <Link to={packagesPath(project)} className="button button--small">
                      {view.packagesOpen}
                    </Link>
                  </span>
                }
              />
            </>
          )}
        </Loading>
        {failure !== null && (
          <p role="alert" className="notice notice--error">
            {say(failure)}
          </p>
        )}
      </Section>
      {pool !== null && row !== undefined && !row.own && <MachineOwnValues project={project} row={row} pool={pool} onSaved={reload} />}
      <div className="pool__actions pool__actions--machine">
        <button type="button" className="button" onClick={onShared}>
          {view.shared}
        </button>
        <Link to={machinePath(card.id)} className="button">
          {view.machinePage}
        </Link>
      </div>
      {connecting && (
        <ConnectMachineDialog
          project={project}
          others={other}
          pooled={pool?.machines ?? []}
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
