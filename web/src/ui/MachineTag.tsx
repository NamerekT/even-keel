import { t } from '../i18n/index.js'

/** The machines a task ran on (BTN-993, `taskMachines`): `Workstation → Home server`, the whole of it in the tip. */
export function MachineTag({ machines }: { machines: string[] }) {
  const text = machines.join(' → ')
  return (
    <span className="tag block__machine" title={`${t.chain.machinesTitle}: ${text}`}>
      {text}
    </span>
  )
}
