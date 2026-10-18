import { useState } from 'react'
import { type Grouping, parseGrouping } from './homeGroups.js'

const GROUPING_KEY = 'even-keel.home.grouping'

/** How Home groups its cards, remembered in the browser; by remote until chosen. */
export function useGrouping(): [Grouping, (grouping: Grouping) => void] {
  const [grouping, setGrouping] = useState(readGrouping)
  const choose = (next: Grouping) => {
    setGrouping(next)
    try {
      localStorage.setItem(GROUPING_KEY, next)
    } catch {}
  }
  return [grouping, choose]
}

function readGrouping(): Grouping {
  try {
    return parseGrouping(localStorage.getItem(GROUPING_KEY))
  } catch {
    return 'remote'
  }
}
