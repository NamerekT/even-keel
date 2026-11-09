import { useState } from 'react'
import { PRIORITIES, type Task } from '../../../src/tracker/model.js'

/** How the backlog panel orders its tasks; a task's number stands for its age, the trackers give no creation date. */
export type BacklogOrder = 'new' | 'old' | 'priority'

export const BACKLOG_ORDERS: readonly BacklogOrder[] = ['new', 'old', 'priority']

export const parseBacklogOrder = (text: string | null): BacklogOrder => BACKLOG_ORDERS.find((order) => order === text) ?? 'new'

const numeric = new Intl.Collator('en', { numeric: true })
const newer = (a: Task, b: Task) => numeric.compare(b.id, a.id)
const rank = (task: Task) => PRIORITIES.indexOf(task.priority)

const COMPARE: Record<BacklogOrder, (a: Task, b: Task) => number> = {
  new: newer,
  old: (a, b) => numeric.compare(a.id, b.id),
  priority: (a, b) => rank(a) - rank(b) || newer(a, b),
}

export const sortBacklog = (tasks: readonly Task[], order: BacklogOrder): Task[] => [...tasks].sort(COMPARE[order])

const ORDER_KEY = 'even-keel.backlog.order'

/** The backlog's order, remembered in the browser for every project; the newest first until chosen. */
export function useBacklogOrder(): [BacklogOrder, (order: BacklogOrder) => void] {
  const [order, setOrder] = useState(readOrder)
  const choose = (next: BacklogOrder) => {
    setOrder(next)
    try {
      localStorage.setItem(ORDER_KEY, next)
    } catch {}
  }
  return [order, choose]
}

function readOrder(): BacklogOrder {
  try {
    return parseBacklogOrder(localStorage.getItem(ORDER_KEY))
  } catch {
    return parseBacklogOrder(null)
  }
}
