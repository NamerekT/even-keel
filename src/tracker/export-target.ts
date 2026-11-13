import { fail } from '../notice/notice.js'
import type { ProfileSet } from '../profiles/model.js'
import type { ExportTarget } from './export.js'
import { issueLink } from './model.js'
import type { TrackerAdapter } from './source.js'

/** The target of a copy on a connection of its own (BTN-1073): what the copy writes through, and its tracker's name. */
export interface OpenedExportTarget extends ExportTarget {
  title: string
  close(): Promise<void>
}

/**
 * Connects to the tracker of `profile` for the project as the wizard would place it — `key` and the tracker's own
 * `place` — and reads its vocabulary. `own` — the tracker the tasks are in now: it is no target.
 */
export async function connectExportTarget(
  adapters: Readonly<Record<string, TrackerAdapter>>,
  set: ProfileSet,
  own: string,
  project: string,
  fields: { profile: string; place: string; key: string },
  timeoutMs: number,
): Promise<OpenedExportTarget> {
  const profile = set.profiles.find((each) => each.id === fields.profile)
  if (profile === undefined) throw fail('profiles.unknown', {})
  const adapter = adapters[profile.kind]
  if (adapter === undefined || profile.kind === own) throw fail('export.noTarget', {})
  const place = fields.place.trim()
  const setup = adapter.setup(profile.values, { [project]: { key: fields.key.trim(), ...(adapter.projectKey !== undefined && place !== '' ? { value: place } : {}) } })
  if (setup === undefined) throw fail('wizard.trackerOff', { tracker: adapter.title, variables: [...adapter.variables] })
  const source = await setup.connect(timeoutMs)
  try {
    if (source.editor === undefined) throw fail('export.noEditor', { tracker: adapter.title })
    const vocabulary = source.vocabulary === undefined ? null : await source.vocabulary(project)
    const template = setup.issueUrl(project)
    return { title: adapter.title, project, editor: source.editor, vocabulary, url: (key) => issueLink(template, key), close: () => source.close() }
  } catch (error) {
    await source.close().catch(() => {})
    throw error
  }
}
