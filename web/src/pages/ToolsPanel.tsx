import { useEffect, useState } from 'react'
import type { ReceivedView, SettingRow, SkillSource, ToolScope, ToolsView } from '../../../src/tools/model.js'
import { formatAgo } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import './tools.css'

const SOURCES: SkillSource[] = ['claudeai', 'project', 'user', 'plugin', 'bundled']
const SCOPES: ToolScope[] = ['user', 'project', 'local', 'chain']
const HIDDEN = 'user-invocable-only'

type Loaded = { state: 'idle' | 'loading' } | { state: 'ready'; view: ToolsView | null } | { state: 'failed'; error: string }

export function ToolsPanel({ project, trim }: { project: string; trim: boolean }) {
  const { tools } = useLive()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'idle' })

  const load = () => {
    setLoaded({ state: 'loading' })
    tools(project).then(
      (view) => setLoaded({ state: 'ready', view }),
      (error: unknown) => setLoaded({ state: 'failed', error: error instanceof Error ? error.message : String(error) }),
    )
  }
  const stale = loaded.state === 'ready' && loaded.view !== null && loaded.view.trim !== trim
  useEffect(() => {
    if (stale) load()
  }, [stale])

  return (
    <details className="tools" onToggle={(event) => event.currentTarget.open && loaded.state === 'idle' && load()}>
      <summary className="backlog__summary">{t.tools.heading}</summary>
      <p className="tools__hint">{t.tools.hint}</p>
      {loaded.state === 'loading' && <p className="placeholder">{t.tools.loading}</p>}
      {loaded.state === 'failed' && <p className="notice notice--error">{`${t.tools.failed}: ${loaded.error}`}</p>}
      {loaded.state === 'ready' && loaded.view !== null && <ToolsBody view={loaded.view} />}
    </details>
  )
}

function ToolsBody({ view }: { view: ToolsView }) {
  const hidden = view.settings.filter((row) => row.kind === 'skill' && row.values.chain === HIDDEN).length
  return (
    <div className="tools__body">
      <p className={view.trim ? 'tools__trim' : 'tools__trim tools__trim--off'}>{view.trim ? t.tools.trimOn(hidden) : t.tools.trimOff}</p>
      <Received received={view.received} />
      <Settings rows={view.settings} />
      <section className="tools__section">
        <h3 className="tools__title">{t.tools.mcpConfigured}</h3>
        {view.mcp.length === 0 ? (
          <p className="tools__muted">{t.tools.noMcp}</p>
        ) : (
          <ul className="tools__list">
            {view.mcp.map((row) => (
              <li key={`${row.scope}:${row.plugin}:${row.name}`} className={row.worktree && !row.disabled ? undefined : 'tools__lost'}>
                <code>{row.name}</code>
                <span className="tools__muted">{` · ${t.tools.mcpScope[row.scope]}${row.plugin === null ? '' : ` ${row.plugin}`}`}</span>
                {!row.worktree && <span className="tools__flag">{t.tools.notInWorktree}</span>}
                {row.disabled && <span className="tools__flag">{t.tools.disabled}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="tools__section">
        <h3 className="tools__title">{t.tools.accounts}</h3>
        {view.accounts.length === 0 ? (
          <p className="tools__muted">{t.tools.accountsSame}</p>
        ) : (
          <ul className="tools__list">
            {view.accounts.map((drift) => (
              <li key={drift.account} className="tools__lost">
                {t.tools.drift(drift.account, drift.keys.join(', '))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Received({ received }: { received: ReceivedView | null }) {
  if (received === null) {
    return (
      <section className="tools__section">
        <h3 className="tools__title">{t.tools.received}</h3>
        <p className="tools__muted">{t.tools.noSession}</p>
      </section>
    )
  }
  const ago = received.at === null ? '' : formatAgo(received.at, new Date())
  return (
    <section className="tools__section">
      <h3 className="tools__title">{t.tools.received}</h3>
      <p className="tools__muted">
        <code>{received.cwd}</code>
        {` · ${t.tools.meta(ago, received.version, received.mode)}`}
      </p>
      <p>{t.tools.skills(received.skills.length, received.listingChars.toLocaleString())}</p>
      <dl className="tools__groups">
        {SOURCES.map((source) => {
          const names = received.skills.filter((skill) => skill.source === source).map((skill) => skill.name)
          if (names.length === 0) return null
          return (
            <div key={source} className={source === 'claudeai' ? 'tools__group tools__group--warn' : 'tools__group'}>
              <dt>{`${t.tools.source[source]} · ${names.length}`}</dt>
              <dd>{names.join(', ')}</dd>
            </div>
          )
        })}
        <div className="tools__group">
          <dt>{t.tools.mcpReceived}</dt>
          <dd>
            {received.mcp.length === 0
              ? t.tools.noMcp
              : received.mcp.map((server, index) => (
                  <span key={server.name} className={server.failed ? 'tools__lost' : undefined}>
                    {index > 0 && ', '}
                    {`${server.name} (${server.failed ? t.tools.mcpFailed : t.tools.mcpTools(server.tools)})`}
                  </span>
                ))}
          </dd>
        </div>
        <div className="tools__group">
          <dt>{t.tools.builtIn(received.tools.length)}</dt>
          <dd>{received.tools.join(', ')}</dd>
        </div>
      </dl>
    </section>
  )
}

function Settings({ rows }: { rows: SettingRow[] }) {
  return (
    <section className="tools__section">
      <h3 className="tools__title">{t.tools.settings}</h3>
      <div className="tools__scroll">
        <table className="tools__table">
          <thead>
            <tr>
              <th>{t.tools.column.name}</th>
              {SCOPES.map((scope) => (
                <th key={scope}>{t.tools.column[scope]}</th>
              ))}
              <th>{t.tools.column.session}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}:${row.name}`} className={row.session === null ? 'tools__lost' : undefined}>
                <td>
                  <span className="tools__kind">{t.tools.kind[row.kind]}</span> <code>{row.name}</code>
                </td>
                {SCOPES.map((scope) => (
                  <td key={scope}>{row.values[scope] ?? ''}</td>
                ))}
                <td className="tools__session">{row.session ?? t.tools.notInSession}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tools__muted">{t.tools.localNote}</p>
    </section>
  )
}
