import { useEffect, useState } from 'react'
import type { ToolsView } from '../../../src/tools/model.js'
import { useLive } from '../live/context.js'

export type Loaded = { state: 'loading' } | { state: 'ready'; view: ToolsView | null } | { state: 'failed'; error: string }

/** Reads every project's view; a project keeps its last view while it is read again after the trim switch. */
export function useToolsViews(projects: string[], trim: boolean): Map<string, Loaded> {
  const { tools } = useLive()
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map())
  const key = projects.join('\u0000')

  useEffect(() => {
    let live = true
    const put = (project: string, value: Loaded) => {
      if (live) setLoaded((previous) => new Map(previous).set(project, value))
    }
    setLoaded((previous) => new Map(projects.map((project) => [project, previous.get(project) ?? { state: 'loading' }])))
    for (const project of projects) {
      tools(project).then(
        (view) => put(project, { state: 'ready', view }),
        (error: unknown) => put(project, { state: 'failed', error: error instanceof Error ? error.message : String(error) }),
      )
    }
    return () => {
      live = false
    }
  }, [key, trim])

  return loaded
}
