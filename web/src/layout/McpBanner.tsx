import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

export function McpBanner() {
  const { state } = useLive()
  if (state === null) return null
  const now = new Date()
  const failed = state.mcpFailed.filter((each) => Date.parse(each.until) > now.getTime())
  if (state.mcpMissing.length === 0 && failed.length === 0) return null

  const byServer = new Map<string, string[]>()
  for (const { project, server } of state.mcpMissing) byServer.set(server, [...(byServer.get(server) ?? []), project])
  const byEnd = new Map<string, { server: string; until: string; projects: string[] }>()
  for (const { project, server, until } of failed) {
    const key = `${server}@${until}`
    byEnd.set(key, { server, until, projects: [...(byEnd.get(key)?.projects ?? []), project] })
  }

  return (
    <div className="banner" role="alert">
      {[...byServer].map(([server, projects]) => (
        <div key={server} className="banner__inner">
          <span>{t.banner.mcp(projects.join(', '), server)}</span>
        </div>
      ))}
      {[...byEnd].map(([key, { server, until, projects }]) => (
        <div key={key} className="banner__inner">
          <span>{t.banner.mcpFailed(projects.join(', '), server, formatMoment(until, now))}</span>
        </div>
      ))}
    </div>
  )
}
