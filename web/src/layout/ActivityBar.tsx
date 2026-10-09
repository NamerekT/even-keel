import { useSyncExternalStore } from 'react'
import { activity } from '../live/activity.js'

const subscribe = (listener: () => void) => activity.subscribe(listener)

export function ActivityBar() {
  const running = useSyncExternalStore(subscribe, () => activity.running() > 0)
  return <div className={running ? 'activity activity--on' : 'activity'} aria-hidden="true" />
}
