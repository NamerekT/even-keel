import { Fold } from '../ui/Fold.js'
import type { ReceivedView, SkillSource, ToolsView } from '../../../src/tools/model.js'
import { formatAgo } from '../format.js'
import { t } from '../i18n/index.js'
import { AccountTag } from '../ui/AccountTag.js'
import { BangIcon } from '../ui/icons.js'
import { useLive } from '../live/context.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { Chip } from './SettingsMatrix.js'

const SOURCES: SkillSource[] = ['claudeai', 'project', 'user', 'plugin', 'bundled']

export function LastSessions({ views }: { views: ToolsView[] }) {
  const label = useProjectLabel()
  return (
    <section className="tools__received">
      <h2 className="tools__heading">{t.tools.received}</h2>
      <div className="tools__cards">
        {views.map((view) => (
          <article key={view.project} className="tools__card">
            {views.length > 1 && <h3 className="tools__title">{label(view.project)}</h3>}
            {view.received === null ? <p className="tools__muted">{t.tools.noSession}</p> : <Received received={view.received} />}
          </article>
        ))}
      </div>
    </section>
  )
}

function Received({ received }: { received: ReceivedView }) {
  const { state } = useLive()
  const ago = received.at === null ? '' : formatAgo(received.at, new Date())
  return (
    <>
      <p className="tools__muted tools__meta">
        <AccountTag account={received.account} agent={state?.sessions.find((session) => session.sessionId === received.sessionId)?.agent} />
        {ago !== '' && <span>{ago}</span>}
        {received.version !== null && <span>{t.tools.cli(received.version)}</span>}
        {received.mode !== null && (
          <span className="tag" title={t.tools.modeTip}>
            {received.mode}
          </span>
        )}
      </p>
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
              <dt className="tools__source">
                {t.tools.source[source]}
                <span className="count-badge">{names.length}</span>
              </dt>
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
                    <span className="tools__server">
                      {server.failed && <BangIcon />}
                      {server.name}
                      {!server.failed && <span className="count-badge">{server.tools}</span>}
                    </span>
                  </Chip>
                ))}
          </dd>
        </div>
      </dl>
      <Fold className="tools__builtin" summary={<>{t.tools.builtIn(received.tools.length)}</>}>
        {() => (
          <>
            <div className="tools__chips">
              {received.tools.map((tool) => (
                <Chip key={tool} tone="plain">
                  {tool}
                </Chip>
              ))}
            </div>
          </>
        )}
      </Fold>
    </>
  )
}
