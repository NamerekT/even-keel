import { parseConfig } from './config.js'

/**
 * Most cases here are about one field of a project, so they write `projects` keyed by the project key, each id the
 * same as its key: the maps of the config, by id, read as they would by key. Such a project is on Huly unless it names
 * its tracker: the default's project key is not what they are about.
 */
export const parse = (raw: Record<string, unknown>, adapters?: Parameters<typeof parseConfig>[1]) => {
  const { projects } = raw
  const listed =
    typeof projects === 'object' && projects !== null && !Array.isArray(projects)
      ? Object.entries(projects).map(([key, entry]) => ({ id: key, key, tracker: 'huly', ...(typeof entry === 'object' ? entry : { repo: entry }) }))
      : projects
  return parseConfig({ ...raw, projects: listed }, adapters)
}
