import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { UsageAnswer } from '../limits/usage.js'
import { limitsOfRollout } from '../codex/rollout.js'
import { root } from '../locations.js'
import { englishOf, notice } from '../notice/notice.js'
import { Packages } from '../packages/service.js'
import { savePackages } from '../packages/store.js'
import { untrustedHooks } from '../codex/plugins.js'

export interface HookRequest {
  session: string
  path: string
}

export function checkHookRequests(requests: HookRequest[], sessions: string[]): string {
  const found = requests.filter((request) => sessions.includes(request.session))
  if (found.length === 0) throw new Error(`no checkpoint package hook request for ${sessions.join(', ')}; received ${JSON.stringify(requests)}`)
  return found.map((request) => `${request.session}${request.path}`).join(', ')
}

export function checkCodexHookList(answer: unknown, id: string): string {
  const data = (answer as { data?: unknown } | null)?.data
  const keys = (Array.isArray(data) ? data : []).flatMap((entry) =>
    (Array.isArray(entry?.hooks) ? entry.hooks : []).flatMap((hook: { pluginId?: unknown; key?: unknown } | null) =>
      hook?.pluginId === id && typeof hook.key === 'string' ? [hook.key] : [],
    ),
  )
  if (keys.length === 0) throw new Error(`no hooks of ${id} in hooks/list; received ${JSON.stringify(answer)}`)
  const untrusted = untrustedHooks(answer, id, keys)
  if (untrusted.length > 0) throw new Error(`${id}: ${untrusted.map((hook) => `${hook.key} ${hook.status}`).join(', ')}; received ${JSON.stringify(answer)}`)
  return `${id}: ${keys.length} trusted hooks`
}

export function checkUsage(answer: UsageAnswer): string {
  if (answer.kind === 'missing') return `no data: ${englishOf(answer.reason)}`
  if (answer.kind !== 'limits') throw new Error(`${answer.kind}: ${englishOf(answer.reason)}`)
  const windows = [['5h', answer.limits.fiveHour], ['7d', answer.limits.sevenDay], ['30d', answer.limits.month]] as const
  const found = windows.filter(([, window]) => window != null && Number.isFinite(window.usedPercentage) && Number.isFinite(Date.parse(window.resetsAt)))
  if (found.length === 0) throw new Error(`no displayable window: ${JSON.stringify(answer)}`)
  return found.map(([name, window]) => `${name} ${window!.usedPercentage} %`).join(', ')
}

/** Read this session, without the usage API or another session masking a changed rollout format. */
export function checkRolloutUsage(text: string): string {
  const raw = text.split('\n').flatMap((line) => {
    try {
      const event = JSON.parse(line)
      const limits = event?.payload?.rate_limits ?? event?.rate_limits
      return limits != null ? [limits] : []
    } catch {
      return []
    }
  })
  let limits: ReturnType<typeof limitsOfRollout>
  try {
    limits = limitsOfRollout(text)
  } catch (error) {
    throw new Error(`cannot parse rate_limits: ${String(error)}; received ${JSON.stringify(raw)}`)
  }
  if (raw.length > 0 && ![limits?.fiveHour, limits?.sevenDay, limits?.month].some((window) => window != null)) {
    throw new Error(`rate_limits yielded no displayable window; received ${JSON.stringify(raw)}`)
  }
  return checkUsage(limits === undefined ? { kind: 'missing', reason: notice('usage.noLimits', {}) } : { kind: 'limits', limits })
}

/** The real package, installed and pinned by the same service the chain uses, in the check's own catalog. */
export async function checkpointPackages(work: string, agent: string, log: (line: string) => void): Promise<Packages> {
  const file = join(work, 'packages.json')
  if (!existsSync(file)) savePackages(file, {
    packages: { 'checkpoint@even-keel': { kind: 'plugin', plugin: { name: 'checkpoint', marketplace: 'even-keel' }, default: true, settings: {}, installs: [] } },
    projects: {}, pins: {},
  })
  const packages = new Packages({
    file, cache: join(work, 'packages'), envFile: join(work, '.env'), repos: { 'cli-check': work },
    globalDir: join(work, 'package-config'), ownDir: root, skillsDir: join(work, 'skills'),
    skillRoots: () => [], claudeConfigs: () => [], rules: { aliases: {}, trackers: [] },
    tracker: () => undefined, agentOf: () => agent, updateMarketplace: async () => {}, addMarketplace: async () => {},
    baseEnv: () => ({}), poolOf: () => ({}), port: 0, log, onChange: () => {},
  })
  packages.release('cli-check', 'cli-check')
  await packages.install('checkpoint@even-keel')
  return packages
}

/** A loopback stub with no mail, standards or checkpoint nudge; records only the hooks' session routes. */
export async function hookService(): Promise<{ url: string; requests: HookRequest[]; close: () => Promise<void> }> {
  const requests: HookRequest[] = []
  const server = createServer((req, res) => {
    req.resume()
    const route = /^\/api\/sessions\/([^/]+)\/(checkpoint|mail|check|standards|note|permission)$/.exec(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    if (route === null) {
      res.writeHead(404).end('{}')
      return
    }
    requests.push({ session: decodeURIComponent(route[1]!), path: `/${route[2]}` })
    res.end(JSON.stringify({ context: 0, message: null, commands: [], standards: [], note: false, decision: { behavior: 'allow' } }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback address for the hook service')
  return {
    url: `http://127.0.0.1:${address.port}`, requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  }
}
