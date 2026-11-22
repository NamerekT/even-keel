import type { EvenKeelConfig } from '../config.js'
import { fail } from '../notice/notice.js'
import { profileFor, type ProfileSet } from '../profiles/model.js'
import type { ImportSource } from './import.js'
import { issueLink } from './model.js'
import type { TrackerAdapter } from './source.js'

/** The project's tracker opened for the import (BTN-1405): where it reads and what it gives. */
export interface OpenedImportSource {
  /** The adapter's kind. */
  tracker: string
  /** The tracker's own place of the project (`trackerProjects`), `''` where the adapter has none. */
  place: string
  /** The prefix of the tasks' ids, kept by the built-in tracker. */
  key: string
  /** The tracker's name for the messages. */
  title: string
  source: ImportSource
  /** A task's page in the tracker by its id, `null` where the tracker gives none: a stop links its task (BTN-1455). */
  url?: (task: string) => string | null
  close(): Promise<void>
}

/**
 * Connects to the tracker the project reads now, on the profile it runs on, for a read of its whole history. `own` —
 * the built-in tracker: a project already on it has nothing to import.
 */
export async function connectImportSource(
  adapters: Readonly<Record<string, TrackerAdapter>>,
  set: ProfileSet,
  config: Pick<EvenKeelConfig, 'keys' | 'trackers' | 'trackerProjects'>,
  own: string,
  project: string,
  timeoutMs: number,
): Promise<OpenedImportSource> {
  const kind = config.trackers[project]
  if (kind === own) throw fail('import.builtin', {})
  const adapter = kind === undefined ? undefined : adapters[kind]
  if (kind === undefined || adapter === undefined) throw fail('machines.unknownProject', {})
  const key = config.keys[project] ?? project
  const place = config.trackerProjects[project] ?? ''
  const profile = profileFor(set, project, kind)
  const setup = profile?.disabled === true ? undefined : adapter.setup(profile?.values ?? {}, { [project]: { key, ...(place === '' ? {} : { value: place }) } })
  if (setup === undefined) throw fail('wizard.trackerOff', { tracker: adapter.title, variables: [...adapter.variables] })
  const connected = await setup.connect(timeoutMs)
  try {
    if (connected.importSource === undefined) throw fail('import.none', { tracker: adapter.title })
    const source = await connected.importSource(project)
    const template = setup.issueUrl(project)
    return { tracker: kind, place, key, title: adapter.title, source, url: (task) => issueLink(template, task), close: () => connected.close() }
  } catch (error) {
    await connected.close().catch(() => {})
    throw error
  }
}
