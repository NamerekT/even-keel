import { useEffect, useId, useRef, useState } from 'react'
import type { CliCopyView } from '../../../src/agent/cli-state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CommandBlock } from '../ui/blocks.js'
import { Banner } from './Banner.js'
import { cliText, INSTALL } from './cliText.js'
import './cliCopies.css'
import '../tools/addPackage.css'

const EVENT = 'even-keel:cli-consent'
export function requestCli(provider: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: provider }))
}

const titleOf = (provider: string) => (t.account.agents as Record<string, string>)[provider] ?? provider
const mb = (bytes: number) => Math.ceil(bytes / 1_000_000)

export function CliProgress({ provider, copy }: { provider: string; copy: CliCopyView }) {
  const text = cliText()
  return <div className="cli-copy__progress" role="status">
    <span>{text.progress}</span>
    <span className="cli-copy__meter">
      <span className="cli-copy__name">{titleOf(provider)}</span>
      <progress aria-label={`${titleOf(provider)} · ${text.progress}`}max={copy.total || undefined} value={copy.total ? copy.received : undefined} />
      <span className="cli-copy__bytes">{copy.total === 0 ? text.preparing : copy.received === copy.total ? text.installing : text.size((copy.received / 1_000_000).toFixed(1), (copy.total / 1_000_000).toFixed(1))}</span>
    </span>
  </div>
}

/** The same actions serve a card, an account dialog and a chain waiting for consent. */
export function CliActions({ provider, onDownload, onSystem, onChecked, primary = false }: { provider: string; onDownload?: () => void; onSystem?: () => void; onChecked?: () => void; primary?: boolean }) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const copy = state?.cliCopies?.[provider]
  if (!copy) return null
  const text = cliText()
  const waiting = copy.source === 'checked' && copy.status !== 'ready'
  const missingSystem = copy.source === 'system' && !copy.system
  if (!waiting && !missingSystem && copy.status !== 'failed') return null
  return <div className="cli-copy">
    {copy.status === 'downloading' ? <CliProgress provider={provider} copy={copy} /> : <>
      {copy.status === 'failed' ? <p className="notice notice--error">{say({ code: 'agent.copyFailed', params: { title: titleOf(provider) } })}</p> : waiting && !primary && <p>{text.missing}</p>}
      {missingSystem && <><p>{text.installingCli}</p><CommandBlock command={INSTALL[provider] ?? ''} /></>}
      <div className="cli-copy__actions">
        {copy.source === 'checked' || copy.status === 'failed' ?
          <button type="button" className={`button button--small${primary ? ' button--primary' : ''}`} disabled={sending} onClick={async () => {
            if (await send('cli/download', { agent: provider })) onDownload?.()
          }}>{copy.status === 'failed' ? text.retry : text.download(mb(copy.approximate))}</button> :
          <button type="button" className="button button--small" disabled={sending} onClick={async () => { if (await send('cli/checked', { agent: provider })) { if (onChecked) onChecked(); else requestCli(provider) } }}>{text.checked}</button>}
        {waiting && copy.system && <button type="button" className="button button--small" disabled={sending} onClick={async () => { if (await send('cli/system', { agent: provider })) onSystem?.() }}>{text.system}</button>}
        {missingSystem && <button type="button" className="button button--small" disabled={sending} onClick={() => void send('cli/check')}>{text.again}</button>}
      </div>
    </>}
    {failure && <p className="notice notice--error">{say(failure)}</p>}
  </div>
}

export function CliDownloadDialog({ provider, onClose, stay = false }: { provider: string; onClose: () => void; stay?: boolean }) {
  const { state } = useLive()
  const copy = state?.cliCopies?.[provider]
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const backdrop = useBackdropClose(dialog, onClose)
  useEffect(() => { dialog.current?.showModal() }, [])
  if (!copy) return null
  const text = cliText()
  return <dialog ref={dialog} className="add-package add-package--narrow" aria-labelledby={heading} onCancel={(event) => { event.preventDefault(); onClose() }} {...backdrop}>
    <div className="add-package__frame">
      <header className="add-package__head"><h2 id={heading} className="add-package__title">{copy.source === 'system' ? titleOf(provider) : text.title}</h2>
        <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>×</button>
      </header>
      <div className="add-package__body">
        {copy.source === 'checked' && copy.status !== 'downloading' && <p>{text.about(titleOf(provider), copy.version, mb(copy.approximate))}</p>}
        <CliActions provider={provider} primary onDownload={stay ? undefined : onClose} onSystem={stay ? undefined : onClose} onChecked={() => {}} />
      </div>
    </div>
  </dialog>
}

export function CliConsent() {
  const { state } = useLive()
  const [provider, setProvider] = useState<string | null>(null)
  useEffect(() => {
    const open = (event: Event) => setProvider((event as CustomEvent<string>).detail)
    window.addEventListener(EVENT, open)
    return () => window.removeEventListener(EVENT, open)
  }, [])
  if (provider === null || !state?.cliCopies?.[provider]) return null
  return <CliDownloadDialog provider={provider} onClose={() => setProvider(null)} />
}

export function CliCopiesBanner() {
  const { state } = useLive()
  const used = new Set([state?.config.shared.provider, ...Object.values(state?.config.projects ?? {}).map((project) => project.provider)])
  const shown = Object.entries(state?.cliCopies ?? {}).filter(([provider, copy]) => copy.status === 'downloading' || copy.status === 'failed' || (used.has(provider) && copy.source === 'checked' && copy.status === 'missing') || state?.chain.active.some((chain) => chain.error?.code === 'agent.copyMissing' && chain.error.params.agent === provider))
  return <Banner tone="info" role="status">{shown.length > 0 ? <div className="banner__inner cli-copy__banner">{shown.map(([provider, copy]) => <div key={provider}>
    {copy.status !== 'downloading' && <strong>{titleOf(provider)}</strong>}
    <CliActions provider={provider} />
  </div>)}</div> : null}</Banner>
}
