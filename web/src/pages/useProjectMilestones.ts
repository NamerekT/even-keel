import { useEffect, useState } from 'react'
import { useLive } from '../live/context.js'
import type { ProjectMilestone } from '../ui/addGhost.js'
import { keepRows } from './keptRows.js'
import { isClosedStatus, type MilestoneRow } from './MilestoneDialogs.js'

/**
 * The milestones of a built-in tracker's project in their order, each with whether it is closed, read from
 * `builtin/milestones` when the project opens and again whenever `stamp` changes (the project's tasks moved): an open
 * milestone left with no task shows as an empty group (BTN-770), a closed one never does (BTN-1462).
 * Off, a failed read, or before the answer — none; the chain then shows only the milestones its tasks carry.
 */
export function useProjectMilestones(project: string, on: boolean, stamp: string): ProjectMilestone[] {
  const { query } = useLive()
  const [found, setFound] = useState<{ project: string; milestones: ProjectMilestone[] }>({ project, milestones: [] })

  useEffect(() => {
    if (!on) return
    let live = true
    // Kept for the source window's milestone table too, so it opens on these rows rather than "Loading…" (BTN-1499).
    keepRows<MilestoneRow>(query, 'builtin/milestones', project).then(
      (rows) => {
        if (live) setFound({ project, milestones: rows.map((row) => ({ name: row.name, closed: isClosedStatus(row.status) })) })
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [project, on, stamp])

  return on && found.project === project ? found.milestones : []
}
