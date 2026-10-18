import { useEffect, useState } from 'react'
import type { TrackerVocabulary } from '../../../src/tracker/source.js'
import { useLive } from '../live/context.js'

/**
 * What the trackers of these projects (by id) name, read once as the panel opens. A tracker that names nothing or does not
 * answer adds nothing: the rules then offer only what the tasks carry, and nothing waits on it or shows an error.
 */
export function useVocabularies(projectIds: readonly string[]): TrackerVocabulary[] {
  const { vocabulary } = useLive()
  const [found, setFound] = useState<TrackerVocabulary[]>([])
  const key = projectIds.join('\u0000')

  useEffect(() => {
    let live = true
    setFound([])
    for (const id of projectIds) {
      vocabulary(id).then(
        (each) => {
          if (live && each !== null) setFound((previous) => [...previous, each])
        },
        () => {},
      )
    }
    return () => {
      live = false
    }
  }, [key])

  return found
}
