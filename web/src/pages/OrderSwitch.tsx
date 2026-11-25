import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { ByPriorityIcon, NewestFirstIcon, OldestFirstIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { BACKLOG_ORDERS, type BacklogOrder } from './backlogOrder.js'
import './orderSwitch.css'

const ORDER_ICONS: Record<BacklogOrder, () => ReactNode> = { new: NewestFirstIcon, old: OldestFirstIcon, priority: ByPriorityIcon }

/** The newest first, the oldest first or by priority, as icons: the backlog panel's and the "Outside the chain" view's. */
export function OrderSwitch({ value, label, onChange }: { value: BacklogOrder; label: string; onChange: (order: BacklogOrder) => void }) {
  return (
    <div className="segmented order-switch" role="group" aria-label={label}>
      {BACKLOG_ORDERS.map((order) => {
        const Icon = ORDER_ICONS[order]
        return (
          <Tipped key={order} tip={t.project.backlogOrders[order]} inline>
            <button
              type="button"
              className={order === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
              aria-label={t.project.backlogOrders[order]}
              aria-pressed={order === value}
              onClick={() => onChange(order)}
            >
              <Icon />
            </button>
          </Tipped>
        )
      })}
    </div>
  )
}
