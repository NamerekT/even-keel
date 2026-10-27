import { withLabels } from '../settings/resolve.js'

/** Resolve the checkpoint threshold from the latest tracker labels, or inherit the project value. */
export function taskCheckpoint(pinned: number | null, labels: string[] | undefined): number | null {
  if (labels === undefined) return pinned
  const values = { 'stats.checkpointTokens': pinned }
  withLabels(values, { project: '', id: '', labels })
  return values['stats.checkpointTokens']
}
