import { useEffect, useState } from 'react'
import { useLive } from '../live/context.js'

/**
 * The milestones of a built-in tracker's project in their order, read from its vocabulary when the project opens and again
 * whenever `stamp` changes (the project's tasks moved): a milestone left with no task shows as an empty group (BTN-770).
 * Off, a failed read, or before the answer — none; the chain then shows only the milestones its tasks carry.
 */
export function useProjectMilestones(project: string, on: boolean, stamp: string): string[] {
  const { vocabulary } = useLive()
  const [found, setFound] = useState<{ project: string; names: string[] }>({ project, names: [] })

  useEffect(() => {
    if (!on) return
    let live = true
    vocabulary(project).then(
      (each) => {
        if (live) setFound({ project, names: each?.milestones ?? [] })
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [project, on, stamp])

  return on && found.project === project ? found.names : []
}
