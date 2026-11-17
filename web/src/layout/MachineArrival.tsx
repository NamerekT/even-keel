import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import type { MachineView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { addMachineOf, joinedMachine } from '../machineAdd.js'
import { machineArrival, usePendingMachine } from '../machineArrival.js'
import { Toast, ToastPresence } from '../ui/Toast.js'
import { useOpenAddMachine } from './AddMachineDialog.js'

/**
 * The machine the window issued a command for and was closed before it joined (BTN-1056): when it joins, a toast
 * opens the window at its projects. A string that expired takes the wait away.
 */
export function MachineArrivalToast() {
  const { read, onMachines } = useLive()
  const pending = usePendingMachine()
  const open = addMachineOf(new URLSearchParams(useLocation().search)) !== null
  const openAdd = useOpenAddMachine()
  const [arrived, setArrived] = useState<MachineView | null>(null)

  useEffect(() => {
    if (pending === null || open) return
    let live = true
    const check = () => {
      if (Date.now() > pending.expiresAt) return machineArrival.set(null)
      void read<MachineView[]>('machines/list', {}).then((list) => {
        const joined = joinedMachine(list, pending.machine)
        if (!live || joined === undefined) return
        machineArrival.set(null)
        setArrived(joined)
      }, () => {})
    }
    check()
    const off = onMachines(check)
    const timer = window.setTimeout(() => machineArrival.set(null), Math.max(0, pending.expiresAt - Date.now()) + 1_000)
    return () => {
      live = false
      off()
      window.clearTimeout(timer)
    }
  }, [pending, open])

  return (
    <ToastPresence>
      {arrived !== null && !open && (
        <Toast
          source="Even Keel"
          icon="/favicon.svg"
          title={t.machines.toastTitle(arrived.name)}
          body={t.machines.toastBody}
          actions={[
            {
              label: t.machines.toastOpen,
              onClick: () => {
                setArrived(null)
                openAdd(arrived.id)
              },
            },
            { label: t.machines.close, onClick: () => setArrived(null) },
          ]}
        />
      )}
    </ToastPresence>
  )
}
