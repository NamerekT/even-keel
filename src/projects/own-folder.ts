import { join } from 'node:path'
import { home } from '../locations.js'

/** Where Even Keel makes the folder of a project without git that names none: `projects/` of its data folder. */
export const projectsDir = (): string => join(home, 'projects')

/** The folder of such a project: a key is not unique and a bare id says nothing to a person, so both. */
export function ownFolder(dir: string, key: string, id: string): string {
  return join(dir, `${key.trim().toLowerCase()}-${id.slice(0, 8)}`)
}
