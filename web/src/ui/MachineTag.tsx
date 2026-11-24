import { Fragment } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n/index.js'
import type { TaskMachine } from '../lanes.js'
import { machinePath } from '../machineColor.js'

/**
 * The machines a task ran on (BTN-993, `taskMachines`): `Workstation → Home server`, the whole of it in the tip. Each
 * name has its machine's colour as a mark and opens the machine's page (BTN-1272); a click does not open the task.
 * Inside a button (a chat card, BTN-1614) `title` replaces the chain's tip and the names are no links.
 */
export function MachineTag({ machines, pinned = false, title }: { machines: TaskMachine[]; pinned?: boolean; title?: string }) {
  // The machines a task is pinned to (BTN-1623) are a choice, not a path: a comma between them, not an arrow.
  const between = pinned ? ', ' : ' → '
  const text = machines.map((machine) => machine.name).join(between)
  return (
    <span className="tag block__machine" title={title ?? `${pinned ? t.chain.machinesPinned : t.chain.machinesTitle}: ${text}`}>
      {machines.map((machine, index) => {
        const mark = machine.color !== undefined && <span className="machine-tag__mark" style={{ background: machine.color }} aria-hidden="true" />
        return (
          <Fragment key={`${machine.id}-${index}`}>
            {index > 0 && between}
            {title !== undefined ? (
              <span>
                {mark}
                {machine.name}
              </span>
            ) : (
              <Link to={machinePath(machine.id)} className="machine-tag__link" onClick={(event) => event.stopPropagation()}>
                {mark}
                {machine.name}
              </Link>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
