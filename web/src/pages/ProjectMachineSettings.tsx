import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import type { MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machinePath } from '../machineColor.js'
import { packagesOver } from '../tools/packageGroups.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { WholeText } from '../ui/WholeText.js'
import { ConnectMachineDialog } from './ConnectMachine.js'
import { IdentityButton } from './IdentityDialog.js'
import { JobWindow } from './JobWindow.js'
import { MachineOwnValues } from './MachineOwnValues.js'
import { usePool } from './ProjectMachinesTab.js'
import { Row, Section, Switch } from './settingsParts.js'
import { TrackerFix } from './TrackerFixButtons.js'
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
  const location = useLocation()
  const { send, sending, failure } = useCommand()
  const [connecting, setConnecting] = useState(false)
  const row = pool?.machines.find((each) => each.id === card.id)
  const other = pool?.others.filter((each) => each.id === card.id) ?? []
  const held = card.projects.find((each) => each.project === project && each.packagesBlocked)
  const blocked = held !== undefined
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
                className={`${ROW} pool__wide`}
                label={view.folder}
                hint={view.folderHint}
                control={<WholeText text={row.folder} path className="pool__folder pool__folder--whole" />}
              />
              <Row className={ROW} label={view.pool} hint={view.poolHint} control={<Switch checked={row.enabled} disabled={sending} label={t.pool.enable(card.name)} onChange={(on) => void enable(on)} />} />
              {card.gitUser !== null && (
                <Row className={`${ROW} pool__block`} label={view.git} hint={view.gitHint} control={card.gitUser ? null : <span className="chip pool__chip pool__chip--warn">{view.gitUnset}</span>}>
                  {card.gitUser && (
                    <div className="pool__author">
                      {card.gitName && <span className="pool__author-name">{card.gitName}</span>}
                      {card.gitEmail && <WholeText text={card.gitEmail} className="pool__author-email" />}
                    </div>
                  )}
                  {card.online && (
                    <div className="pool__block-actions">
                      <IdentityButton
                        className="button button--small"
                        label={card.gitUser ? t.machinePage.gitChange : t.machinePage.gitSet}
                        machine={{ id: card.id, name: card.name, gitName: card.gitName, gitEmail: card.gitEmail }}
                      />
                    </div>
                  )}
                </Row>
              )}
              <Row
                className={`${ROW} pool__block`}
                label={view.packages}
                hint={view.packagesHint}
                control={<span className={blocked ? 'chip pool__chip pool__chip--warn' : 'chip pool__chip pool__chip--ok'}>{blocked ? view.packagesBlocked : view.packagesReady}</span>}
              >
                {held !== undefined && <PackagesWhy held={held} />}
                <div className="pool__block-actions">
                  <Link to={packagesOver(project, location)} className="button button--small">
                    {view.packagesOpen}
                  </Link>
                  {held?.trackerMissing != null && state !== null && <TrackerFix state={state} project={project} />}
                </div>
              </Row>
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

/**
 * Why the project's packages hold the machine (BTN-1300): the packages to finish and the tracker's server no package
 * brings, a short line each with its names as tags and the whole sentence in a tip (BTN-1564); neither — what passes by
 * itself. The fixes are the block's buttons under these lines.
 */
function PackagesWhy({ held }: { held: MachineCard['projects'][number] }) {
  const view = t.machinePanel.view
  const tracker = held.trackerMissing
  const unready = held.packagesUnready
  return (
    <div className="pool__packages-why">
      {unready.length > 0 && <WhyLine tip={view.packagesUnready(unready)} text={view.packagesUnreadyShort} names={unready} />}
      {tracker !== null && <WhyLine tip={view.trackerMissing(tracker)} text={view.trackerMissingShort} names={[tracker]} />}
      {unready.length === 0 && tracker === null && <WhyLine tip={view.packagesPassing} text={view.packagesPassingShort} names={[]} />}
    </div>
  )
}

function WhyLine({ tip, text, names }: { tip: string; text: string; names: string[] }) {
  return (
    <Tipped tip={tip} focusable align="start" className="pool__packages-problem">
      <span className="pool__packages-problem-text">{text}</span>
      {names.map((name) => (
        <span key={name} className="tag">
          {name}
        </span>
      ))}
    </Tipped>
  )
}
