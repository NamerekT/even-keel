import { Fragment } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n/index.js'
import type { TaskMachine } from '../lanes.js'
import { machinePath } from '../machineColor.js'
import { MachineMark, useMachineWords } from './MachineIcon.js'

/** Why a pinned task waits that its machines' tag shows (`PinWait`): busy, or off the link. */
export type TagWait = 'busy' | 'offline'

/**
 * The machines a task ran on (BTN-993, `taskMachines`): `Workstation → Home server`, the whole of it in the tip. Each
 * name has its machine's icon before it (BTN-1595) and opens the machine's page (BTN-1272); a click does not open the
 * task. Inside a button (a chat card, BTN-1614) `title` replaces the chain's tip and the names are no links. A pinned
 * task waiting for its machines (`wait`, BTN-1807) has the reason on the tip's second line; machines off the link dim
 * the tag.
 */
export function MachineTag({ machines, pinned = false, wait, title }: { machines: TaskMachine[]; pinned?: boolean; wait?: TagWait | undefined; title?: string }) {
  const words = useMachineWords()
  // The machines a task is pinned to (BTN-1623) are a choice, not a path: a comma between them, not an arrow.
  const between = pinned ? ', ' : ' → '
  const text = machines.map((machine) => `${machine.name} (${words(machine.id)})`).join(between)
  const why = wait === undefined ? '' : `\n${t.chain.pinWait[wait]}`
  return (
    <span
      className={wait === 'offline' ? 'machine-tag machine-tag--offline block__machine' : 'machine-tag block__machine'}
      title={title ?? `${pinned ? t.chain.machinesPinned : t.chain.machinesTitle}: ${text}${why}`}
    >
      {machines.map((machine, index) => {
        const body = <>
          <MachineMark id={machine.id} color={machine.color} />
          <span className="machine-tag__name">{machine.name}</span>
        </>
        return (
          <Fragment key={`${machine.id}-${index}`}>
            {index > 0 && <span className="machine-tag__between">{between}</span>}
            {title !== undefined ? <span className="machine-tag__link">{body}</span> : (
              <Link to={machinePath(machine.id)} className="machine-tag__link" onClick={(event) => event.stopPropagation()}>
                {body}
              </Link>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
