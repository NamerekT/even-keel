import { chainRefusal, useChainRefusal, type ChainRefusal } from '../chainRefusal.js'
import { say, t } from '../i18n/index.js'
import { Toast, ToastPresence, useToastTimer } from '../ui/Toast.js'
import { TOAST_MS } from './EventToasts.js'

/**
 * The server's refusal of a drop in the chain (BTN-1644), in the page's corner rather than under the list's last row,
 * dozens of rows away from the drop: the task that stayed where it was, why and what to do.
 */
export function ChainRefusalToast() {
  const refusal = useChainRefusal()
  return <ToastPresence>{refusal !== null && <RefusalToast key={`${refusal.task}:${refusal.notice.code}`} refusal={refusal} />}</ToastPresence>
}

function RefusalToast({ refusal }: { refusal: ChainRefusal }) {
  const close = () => chainRefusal.set(null)
  const timer = useToastTimer(TOAST_MS, close)
  return (
    <Toast
      source="Even Keel"
      icon="/favicon.svg"
      title={t.chain.dropRefused(refusal.task)}
      body={say(refusal.notice)}
      actions={[{ label: t.chain.dropRefusedClose, onClick: close }]}
      timer={timer}
    />
  )
}
