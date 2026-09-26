import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { EventHub } from './events.js'
import { createBatonServer } from './server.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = loadConfig(process.env.BATON_CONFIG ?? join(root, 'baton.config.json'))
const hub = new EventHub()
const startedAt = new Date().toISOString()

const server = createBatonServer({
  hub,
  publicDir: join(root, 'public'),
  getState: () => ({ startedAt, projects: Object.keys(config.projects), chain: [] }),
})

setInterval(() => hub.broadcast('ping', { at: new Date().toISOString() }), 15_000).unref()

server.listen(config.port, config.host, () => {
  console.log(`baton listening on http://${config.host}:${config.port}`)
})
