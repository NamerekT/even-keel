import { useEffect, useId, useRef, useState } from 'react'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CommandBlock } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { CliProgress, mb, titleOf } from './CliCopies.js'
import { cliText, INSTALL } from './cliText.js'
import './cliCopies.css'
import '../tools/addPackage.css'

/**
 * The move to the checked copy (BTN-603): a copy already downloaded is switched to at once, one that is not asks first —
 * the dialog's "Download" writes `checked` and starts the download, "Cancel" leaves the source as it was.
 */
export function useCheckedSwitch(provider: string) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const [asking, setAsking] = useState(false)
  const copy = state?.cliCopies?.[provider]
  const pick = () => {
    if (copy?.status === 'ready') void send('cli/checked', { agent: provider })
    else setAsking(true)
  }
  const dialog = asking ? <CliConsentDialog provider={provider} onClose={() => setAsking(false)} /> : null
  return { pick, dialog, sending, failure }
}

function CliConsentDialog({ provider, onClose }: { provider: string; onClose: () => void }) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const copy = state?.cliCopies?.[provider]
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const backdrop = useBackdropClose(dialog, onClose)
  useEffect(() => { dialog.current?.showModal() }, [])
  if (!copy) return null
  const text = cliText()
  return <dialog ref={dialog} className="add-package add-package--narrow" aria-labelledby={heading} onCancel={(event) => { event.preventDefault(); onClose() }} {...backdrop}>
    <div className="add-package__frame">
      <header className="add-package__head">
        <h2 id={heading} className="add-package__title">{text.ask(titleOf(provider), copy.version, mb(copy.approximate))}</h2>
        <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>×</button>
      </header>
      <div className="add-package__body">
        <p className="add-package__question">{text.askNote}</p>
        {failure && <p className="notice notice--error">{say(failure)}</p>}
      </div>
      <footer className="add-package__foot">
        <span className="add-package__spacer" />
        <button type="button" className="button" disabled={sending} onClick={onClose}>{t.common.cancel}</button>
        <button type="button" className="button button--primary" disabled={sending} onClick={async () => { if (await send('cli/download', { agent: provider })) onClose() }}>{text.start}</button>
      </footer>
    </div>
  </dialog>
}

/**
 * Which CLI a provider's sessions run on (BTN-603): the installed one or Even Keel's checked copy, two radios. Neither
 * is marked while the source is the installed CLI and there is none: the install command stands under them then. The
 * copy's download shows its progress, a missing or failed one its button. `locked` — the execution mode picked runs
 * only on the copy (BTN-610): turning it on moves to the copy as a pick of it would, and the installed one stays shut
 * until it turns off.
 */
export function CliSourceChoice({ provider, label, locked = false }: { provider: string; label?: string; locked?: boolean }) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const checked = useCheckedSwitch(provider)
  const name = useId()
  const copy = state?.cliCopies?.[provider]
  const wasLocked = useRef(locked)
  useEffect(() => {
    if (locked && !wasLocked.current && copy !== undefined && copy.source !== 'checked') checked.pick()
    wasLocked.current = locked
  }, [locked])
  if (!copy) return null
  const text = cliText()
  const chosen = copy.source === 'checked' ? 'checked' : copy.system ? 'system' : null
  const busy = sending || checked.sending
  const download = <button type="button" className="button button--small" disabled={busy} onClick={() => void send('cli/download', { agent: provider })}>
    {copy.status === 'failed' ? text.retry : text.download(mb(copy.approximate))}
  </button>
  const yours = <label className="settings__check">
    <input type="radio" name={name} checked={chosen === 'system'} disabled={!copy.system || busy || locked} onChange={() => void send('cli/system', { agent: provider })} />
    {copy.system ? text.yours(copy.installed ?? null) : text.yoursMissing}
  </label>
  return <div className="cli-source">
    <div className="cli-source__options" role="radiogroup" aria-label={label ?? text.which}>
      {locked ? <Tipped tip={t.shared.cliLocked} focusable>{yours}</Tipped> : yours}
      <label className="settings__check">
        <input type="radio" name={name} checked={chosen === 'checked'} disabled={busy} onChange={checked.pick} />
        {copy.status === 'ready' ? text.checkedReady(copy.version) : text.checkedOffer(copy.version, mb(copy.approximate))}
      </label>
    </div>
    {chosen === null && copy.status !== 'downloading' && <div className="cli-source__install">
      <CommandBlock command={INSTALL[provider] ?? ''} />
      <button type="button" className="button button--small" disabled={busy} onClick={() => void send('cli/check')}>{text.again}</button>
    </div>}
    {copy.status === 'downloading' && <div className="cli-copy"><CliProgress provider={provider} copy={copy} /></div>}
    {copy.status === 'failed' && <div className="cli-source__problem">
      <p className="notice notice--error">{say({ code: 'agent.copyFailed', params: { title: titleOf(provider) } })}</p>
      {download}
    </div>}
    {copy.source === 'checked' && copy.status === 'missing' && <div className="cli-source__problem">
      <span>{text.missing}</span>
      {download}
    </div>}
    {[failure, checked.failure].map((each, index) => each && <p key={index} className="notice notice--error">{say(each)}</p>)}
    {checked.dialog}
  </div>
}
