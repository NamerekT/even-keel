import { parseConfig } from '../src/config.js'
import { loadEnv, stateDirOf } from '../src/locations.js'
import { englishOf, NoticeError, noticeOf } from '../src/notice/notice.js'
import { profileFor } from '../src/profiles/model.js'
import { readProfiles } from '../src/profiles/store.js'
import { exportConfig } from '../src/settings/import.js'
import { assignBreakLabels, selectProjects } from '../src/stats/break-labels.js'
import { readStateDatabase } from '../src/storage/owner.js'
import { ADAPTERS } from '../src/tracker/adapters.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.some((arg) => arg.startsWith('-') && arg !== '--dry-run')) {
    throw new Error('usage: npm run break-labels -- [--dry-run] <project key or GUID> ...')
  }
  const dryRun = args.includes('--dry-run')
  loadEnv()
  const reader = await readStateDatabase(stateDirOf())
  if (reader === undefined) throw new Error('No state database; use EVEN_KEEL_DATA or EVEN_KEEL_STATE_DIR of an existing installation')
  try {
    const config = parseConfig(JSON.parse(await exportConfig(reader.db)))
    const profiles = await readProfiles(reader.db)
    const projects = selectProjects(config.keys, args.filter((arg) => arg !== '--dry-run'))
    console.log(JSON.stringify({ at: new Date().toISOString(), action: 'start', dryRun, projects }))
    for (const project of projects) {
      const kind = config.trackers[project]!
      const profile = profileFor(profiles, project, kind)
      if (profile === undefined) throw new Error(`No tracker profile for ${config.keys[project]}`)
      const setup = ADAPTERS[kind]!.setup(profile.values, {
        [project]: { key: config.keys[project]!, value: config.trackerProjects[project] },
      })
      if (setup === undefined) throw new Error(`Tracker is not configured for ${config.keys[project]}`)
      const source = await setup.connect(15_000)
      try {
        await assignBreakLabels(source, project, dryRun, (event) => {
          console.log(JSON.stringify({ at: new Date().toISOString(), project, ...event }))
        })
      } finally {
        await source.close()
      }
    }
  } finally {
    await reader.close()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof NoticeError ? englishOf(noticeOf(error)) : (error as Error).message)
  process.exitCode = 1
}
