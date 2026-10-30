import { useEffect, useRef, useState, type ReactNode } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { ProfileKindView, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Field } from '../tools/AddPackage.js'
import { SectionLabel } from '../ui/blocks.js'
import { HelpTip } from './settingsParts.js'

const POLL_MS = 1500

/** A browser grant of this dialog: its flow is valid only while the fields still hold `values`. */
export interface Grant {
  flow: string
  values: string
}

/** `undefined` keeps the stored grant, `null` drops it on saving. */
export type GrantChoice = Grant | null | undefined

interface McpProps {
  children: ReactNode
  kind: ProfileKindView
  profile: ProfileView | undefined
  /** The draft the grant is bound to, as `profiles/check` takes it. */
  body: Record<string, unknown>
  values: string
  /** The labels of the profile's blank fields: the connection is bound to them, so they come first. */
  blank: string[]
  grant: GrantChoice
  onGrant: (grant: GrantChoice) => void
}

/** The MCP part of a tracker profile (BTN-475): connect through OAuth, the state of the stored grant, and GitHub's OAuth App. */
export function ProfileMcp({ kind, profile, body, values, blank, grant, onGrant, children }: McpProps) {
  const { query } = useLive()
  const [waiting, setWaiting] = useState<string | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [asked, setAsked] = useState(false)
  const [client, setClient] = useState({ id: '', secret: '' })
  const popup = useRef<Window | null>(null)
  const callback = `${window.location.origin}/api/profiles/oauth/callback`
  const github = kind.kind === 'github'
  const fresh = grant !== undefined && grant !== null && grant.values === values
  const stored = grant === null ? undefined : profile?.mcpOAuth?.state
  const missing = github
    ? [...blank, ...(client.id.trim() === '' ? [t.profiles.mcp.clientId] : []), ...(client.secret.trim() === '' ? [t.profiles.mcp.clientSecret] : [])]
    : blank

  // `query` is new on every render of the page: the poll reads the latest through a ref instead of restarting.
  const latest = useRef({ query, onGrant })
  latest.current = { query, onGrant }
  /** The fields the attempt was started with: the server binds the grant to them. */
  const boundTo = useRef(values)

  useEffect(() => {
    if (waiting === null) return
    let stop = false
    const timer = window.setInterval(() => {
      const { query } = latest.current
      void query<{ state: 'waiting' | 'ready' | 'failed'; error: Notice | null }>('profiles/oauth/status', { flow: waiting })
        .then((status) => {
          if (stop) return
          if (status.state === 'waiting') {
            // Closed by hand before the callback: the attempt is given up.
            if (popup.current?.closed !== true) return
            void query('profiles/oauth/cancel', { flow: waiting }).catch(() => {})
          } else if (status.state === 'ready') latest.current.onGrant({ flow: waiting, values: boundTo.current })
          else setFailure(status.error)
          popup.current?.close()
          setWaiting(null)
        })
        .catch((error: unknown) => {
          if (stop) return
          setFailure(noticeOf(error))
          setWaiting(null)
        })
    }, POLL_MS)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [waiting])

  const connect = async () => {
    setFailure(null)
    setBlocked(false)
    setAsked(true)
    if (missing.length > 0) return
    // Opened at the click, or the browser blocks it; the address comes once the attempt exists.
    const opened = window.open('about:blank', 'even-keel-oauth', 'popup,width=640,height=760')
    if (opened === null) {
      setBlocked(true)
      return
    }
    popup.current = opened
    boundTo.current = values
    try {
      const started = await query<{ flow: string; url: string }>('profiles/oauth/start', { ...body, ...(github ? { client } : {}) })
      opened.location.href = started.url
      setWaiting(started.flow)
    } catch (error) {
      opened.close()
      setFailure(noticeOf(error))
    }
  }

  const cancel = () => {
    if (waiting !== null) void query('profiles/oauth/cancel', { flow: waiting }).catch(() => {})
    popup.current?.close()
    setWaiting(null)
  }

  return (
    <section className="profile-mcp" aria-label={t.profiles.mcp.title}>
      <span className="profile-mcp__head">
        <SectionLabel>{t.profiles.mcp.title}</SectionLabel>
        <HelpTip text={t.profiles.mcp.hint} align="start" />
      </span>
      {kind.kind === 'jira' && profile === undefined && (
        <p className="settings__hint profile-mcp__hint">
          {t.profiles.mcp.noSite}{' '}
          <a href="https://www.atlassian.com/software/jira/free" target="_blank" rel="noreferrer">
            {t.profiles.mcp.newSite}
          </a>
        </p>
      )}
      {github && (
        <>
          <p className="settings__hint profile-mcp__hint">
            {t.profiles.mcp.githubIntro}{' '}
            <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">
              {t.profiles.mcp.githubApp}
            </a>
          </p>
          <Field label={t.profiles.mcp.callback} hint={t.profiles.mcp.callbackHint}>
            {(id) => <input id={id} className="add-package__input add-package__input--mono" value={callback} readOnly onFocus={(event) => event.target.select()} />}
          </Field>
          <Field label={t.profiles.mcp.clientId}>
            {(id) => <input id={id} className="add-package__input add-package__input--mono" value={client.id} autoComplete="off" spellCheck={false} onChange={(event) => setClient({ ...client, id: event.target.value })} />}
          </Field>
          <Field label={t.profiles.mcp.clientSecret}>
            {(id) => <input id={id} className="add-package__input add-package__input--mono" type="password" value={client.secret} autoComplete="off" spellCheck={false} onChange={(event) => setClient({ ...client, secret: event.target.value })} />}
          </Field>
        </>
      )}
      {fresh ? (
        <p className="profiles__ok">{t.profiles.mcp.ready}</p>
      ) : stored === 'connected' ? (
        <p className="profiles__ok">{t.profiles.mcp.connected}</p>
      ) : stored === 'reconnect' ? (
        <p className="notice notice--warn">{t.profiles.mcp.revoked}</p>
      ) : grant === null && profile?.mcpOAuth !== undefined ? (
        <p className="settings__hint profile-mcp__hint">{t.profiles.mcp.dropped}</p>
      ) : null}
      {waiting !== null && <p className="settings__hint profile-mcp__hint">{t.profiles.mcp.waiting}</p>}
      {asked && missing.length > 0 && <p className="notice notice--error">{t.profiles.unfilled(missing)}</p>}
      {blocked && <p className="notice notice--error">{t.profiles.mcp.blocked}</p>}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <div className="profile-mcp__actions">
        {waiting !== null ? (
          <button type="button" className="button button--small" onClick={cancel}>
            {t.profiles.mcp.cancel}
          </button>
        ) : (
          <button type="button" className="button button--small" onClick={() => void connect()}>
            {fresh || stored !== undefined ? t.profiles.mcp.again : t.profiles.mcp.connect}
          </button>
        )}
        {waiting === null && (fresh || stored !== undefined) && (
          <button type="button" className="button button--small" onClick={() => onGrant(profile?.mcpOAuth === undefined ? undefined : null)}>
            {t.profiles.mcp.disconnect}
          </button>
        )}
        {waiting === null && grant === null && profile?.mcpOAuth !== undefined && (
          <button type="button" className="button button--small" onClick={() => onGrant(undefined)}>
            {t.profiles.mcp.keep}
          </button>
        )}
      </div>
      <div className="profile-mcp__fallback">
        <span className="settings__hint">{t.profiles.mcp.fallback}</span>
        {children}
      </div>
    </section>
  )
}
