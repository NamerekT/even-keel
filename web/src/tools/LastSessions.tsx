import type { ReceivedView, SkillSource, ToolsView } from '../../../src/tools/model.js'
import { formatAgo } from '../format.js'
import { t } from '../i18n/index.js'
import { Chip } from './SettingsMatrix.js'

const SOURCES: SkillSource[] = ['claudeai', 'project', 'user', 'plugin', 'bundled']

export function LastSessions({ views }: { views: ToolsView[] }) {
  return (
    <section className="tools__received">
      <h2 className="tools__heading">{t.tools.received}</h2>
      <div className="tools__cards">
        {views.map((view) => (
          <article key={view.project} className="tools__card">
            {views.length > 1 && <h3 className="tools__title">{view.project}</h3>}
            {view.received === null ? <p className="tools__muted">{t.tools.noSession}</p> : <Received received={view.received} />}
          </article>
        ))}
      </div>
    </section>
  )
}

function Received({ received }: { received: ReceivedView }) {
  const ago = received.at === null ? '' : formatAgo(received.at, new Date())
  return (
    <>
      <p className="tools__muted">{t.tools.meta(ago, received.version, received.mode)}</p>
      {received.cwd !== null && (
        <p className="tools__cwd" title={received.cwd}>
          <code>{received.cwd}</code>
        </p>
      )}
      <p>{t.tools.skills(received.skills.length, received.listingChars.toLocaleString())}</p>
      <dl className="tools__groups">
        {SOURCES.map((source) => {
          const names = received.skills.filter((skill) => skill.source === source).map((skill) => skill.name)
          if (names.length === 0) return null
          return (
            <div key={source} className="tools__group">
              <dt>{`${t.tools.source[source]} · ${names.length}`}</dt>
              <dd className="tools__chips">
                {names.map((name) => (
                  <Chip key={name} tone={source === 'claudeai' ? 'lost' : 'plain'}>
                    {name}
                  </Chip>
                ))}
              </dd>
            </div>
          )
        })}
        <div className="tools__group">
          <dt>{t.tools.mcpReceived}</dt>
          <dd className="tools__chips">
            {received.mcp.length === 0
              ? t.tools.noMcp
              : received.mcp.map((server) => (
                  <Chip key={server.name} tone={server.failed ? 'lost' : 'plain'} title={server.failed ? t.tools.mcpFailed : t.tools.mcpTools(server.tools)}>
                    {server.failed ? `${server.name} · ${t.tools.mcpFailed}` : `${server.name} · ${server.tools}`}
                  </Chip>
                ))}
          </dd>
        </div>
      </dl>
      <details className="tools__builtin">
        <summary>{t.tools.builtIn(received.tools.length)}</summary>
        <div className="tools__chips">
          {received.tools.map((tool) => (
            <Chip key={tool} tone="plain">
              {tool}
            </Chip>
          ))}
        </div>
      </details>
    </>
  )
}
