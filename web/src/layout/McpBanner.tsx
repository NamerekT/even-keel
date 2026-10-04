import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

export function McpBanner() {
  const { state } = useLive()
  if (state === null || state.mcpMissing.length === 0) return null

  const byServer = new Map<string, string[]>()
  for (const { project, server } of state.mcpMissing) byServer.set(server, [...(byServer.get(server) ?? []), project])

  return (
    <div className="banner" role="alert">
      {[...byServer].map(([server, projects]) => (
        <div key={server} className="banner__inner">
          <span>{t.banner.mcp(projects.join(', '), server)}</span>
        </div>
      ))}
    </div>
  )
}
