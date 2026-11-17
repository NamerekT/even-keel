import { createContext, useContext, useEffect, useState } from 'react'
import type { TrackerVocabulary } from '../../../src/tracker/source.js'
import { useLive } from '../live/context.js'

/**
 * Whether the trackers' vocabularies are still read, for the fields they fill (the labels and milestones offered):
 * such a field opened meanwhile shows the loader in its list (BTN-1257). The panel that reads them provides it.
 */
export const VocabularyReading = createContext(false)

export function useVocabularyReading(): boolean {
  return useContext(VocabularyReading)
}

/**
 * What the trackers of these projects (by id) name, read once as the panel opens, and whether some are still read. A
 * tracker that names nothing or does not answer adds nothing: the rules then offer only what the tasks carry, and
 * nothing waits on it or shows an error.
 */
export function useVocabularies(projectIds: readonly string[]): { vocabularies: TrackerVocabulary[]; reading: boolean } {
  const { vocabulary } = useLive()
  const [found, setFound] = useState<TrackerVocabulary[]>([])
  const [waiting, setWaiting] = useState(projectIds.length)
  const key = projectIds.join('\u0000')

  useEffect(() => {
    let live = true
    setFound([])
    setWaiting(projectIds.length)
    const done = () => live && setWaiting((before) => before - 1)
    for (const id of projectIds) {
      vocabulary(id).then(
        (each) => {
          if (live && each !== null) setFound((previous) => [...previous, each])
          done()
        },
        done,
      )
    }
    return () => {
      live = false
    }
  }, [key])

  return { vocabularies: found, reading: waiting > 0 }
}
