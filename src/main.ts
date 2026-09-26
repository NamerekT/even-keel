import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { EventHub } from './events.js'
import { readHulyCredentials } from './huly/credentials.js'
import { HulyLink } from './huly/link.js'
import type { HulyTask } from './huly/model.js'
import { StatusPoller } from './huly/poller.js'
import { connectHuly } from './huly/source.js'
import { createBatonServer } from './server.js'

const HULY_POLL_MS = 5_000
const HULY_TIMEOUT_MS = 15_000

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const config = loadConfig(process.env.BATON_CONFIG ?? join(root, 'baton.config.json'))
const credentials = readHulyCredentials(process.env)
const hub = new EventHub()
const startedAt = new Date().toISOString()
let tasks: HulyTask[] = []

const getState = () => ({ startedAt, projects: Object.keys(config.projects), chain: [], tasks })

const server = createBatonServer({ hub, publicDir: join(root, 'public'), getState })

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()

server.listen(config.port, config.host, () => {
  console.log(`baton listening on http://${config.host}:${config.port}`)
})

if (credentials === undefined) {
  console.log('huly: HULY_* variables are not set, tracker is off')
} else {
  const link = new HulyLink({ connect: () => connectHuly(credentials, HULY_TIMEOUT_MS), timeoutMs: HULY_TIMEOUT_MS })
  const report = (error: unknown) => console.error(`huly: ${error instanceof Error ? error.message : String(error)}`)

  const poller = new StatusPoller({
    link,
    watched: () => tasks.map((task) => task.id),
    intervalMs: HULY_POLL_MS,
    onChange: (changes) => {
      const byId = new Map(changes.map((change) => [change.id, change.to]))
      tasks = tasks.flatMap((task) => {
        const status = byId.has(task.id) ? byId.get(task.id) : task.status
        return status ? [{ ...task, status }] : []
      })
      hub.broadcast('state', getState())
    },
    onError: report,
  })

  const loadTasks = async (): Promise<void> => {
    try {
      const perProject = await Promise.all(
        Object.keys(config.projects).map((project) => link.run((source) => source.openTasks(project))),
      )
      tasks = perProject.flat()
      hub.broadcast('state', getState())
      poller.start()
    } catch (error) {
      report(error)
      setTimeout(() => void loadTasks(), HULY_POLL_MS)
    }
  }
  void loadTasks()
}
