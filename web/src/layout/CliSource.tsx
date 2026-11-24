import { useEffect, useId, useRef, useState } from 'react'
import { say, sayAtField, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CommandBlock } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { CliProgress, mb, titleOf } from './CliCopies.js'
import { cliLockOf, type CliSource } from './cliLock.js'
import { cliText, installCommand } from './cliText.js'
import { InstallButton, InstallOutput, installOf } from './CliInstall.js'
import './cliCopies.css'
import { CloseIcon } from '../ui/icons.js'
import '../tools/addPackage.css'

/**
 * The move to the checked copy (BTN-603): a copy already downloaded is switched to at once, one that is not asks first —
 * the dialog's "Download" writes `checked` and starts the download, "Cancel" leaves the source as it was. With `onPick`
 * (a form, BTN-682) the pick only goes into the form: the consent is asked once the form is saved (`useCommand`).
 */
export function useCheckedSwitch(provider: string, onPick?: (source: CliSource) => void) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const [asking, setAsking] = useState<OwnCopy | null>(null)
  const copy = state?.cliCopies?.[provider]
  /** `latest` — Even Keel's copy of the newest release (BTN-1539): a downloaded one is switched to with a look for a newer one. */
  const pick = (source: OwnCopy = 'checked') => {
    if (onPick) onPick(source)
    else if (source === 'checked' && copy?.checkedStatus === 'ready') void send('cli/checked', { agent: provider })
    else if (source === 'latest' && copy?.latest != null) void send('cli/download', { agent: provider, source })
    else setAsking(source)
  }
  const dialog = asking !== null ? <CliConsentDialog provider={provider} source={asking} onClose={() => setAsking(null)} /> : null
  return { pick, dialog, sending, failure }
}

type OwnCopy = 'checked' | 'latest'

function CliConsentDialog({ provider, source, onClose }: { provider: string; source: OwnCopy; onClose: () => void }) {
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
        <h2 id={heading} className="add-package__title">{source === 'latest' ? text.askLatest(titleOf(provider), mb(copy.approximate)) : text.ask(titleOf(provider), copy.version, mb(copy.approximate))}</h2>
        <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="add-package__body">
        <p className="add-package__question">{source === 'latest' ? text.askLatestNote : text.askNote}</p>
      </div>
      {failure && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
      <footer className="add-package__foot">
        <span className="add-package__spacer" />
        <button type="button" className="button" disabled={sending} onClick={onClose}>{t.common.cancel}</button>
        <button type="button" className="button button--primary" disabled={sending} onClick={async () => { if (await send('cli/download', { agent: provider, ...(source === 'latest' ? { source } : {}) })) onClose() }}>{text.start}</button>
      </footer>
    </div>
  </dialog>
}

/**
 * Which CLI a provider's sessions run on (BTN-603): the installed one or Even Keel's checked copy, two radios. Neither
 * is marked while the source is the installed CLI and there is none: the install command stands under them then. The
 * copy's download shows its progress, a missing or failed one its button. `execution` — the mode the form holds: one that
 * runs only on the copy (BTN-610) moves to the copy as a pick of it would, and keeps the installed one shut (`cliLockOf`).
 * With `onPick` the choice is a form's field (/settings, BTN-682): a pick goes there, `picked` is the form's unsaved
 * one, and the service gets it with the form, the copy's download asked after the save; without it (the setup wizard)
 * a pick is sent at once.
 */
export function CliSourceChoice({ provider, label, execution, picked, onPick }: {
  provider: string
  label?: string
  execution?: string
  picked?: CliSource
  onPick?: (source: CliSource) => void
}) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const checked = useCheckedSwitch(provider, onPick)
  const name = useId()
  const copy = state?.cliCopies?.[provider]
  const source = picked ?? copy?.source
  const lock = cliLockOf(provider, execution)
  const locked = lock === 'picked'
  const wasLocked = useRef(locked)
  useEffect(() => {
    if (locked && !wasLocked.current && copy !== undefined && source !== 'checked') checked.pick()
    wasLocked.current = locked
  }, [locked])
  if (!copy) return null
  const text = cliText()
  const chosen = source === 'checked' || source === 'latest' ? source : copy.system ? 'system' : null
  const busy = sending || checked.sending
  // The service runs the same command itself where it can (BTN-1502).
  const runs = state.account.installs?.[provider]
  const install = installOf(state.account.install, provider)
  const download = <button type="button" className="button button--small" disabled={busy} onClick={() => void send('cli/download', { agent: provider, ...(copy.source === 'latest' ? { source: 'latest' } : {}) })}>
    {copy.status === 'failed' ? text.retry : text.download(mb(copy.approximate))}
  </button>
  // Offered only where nobody can install the CLI (BTN-1539), or kept while it is the choice.
  const latest = copy.latest !== undefined && (!copy.installable || source === 'latest' || copy.source === 'latest')
  const latestReady = copy.latest !== undefined && copy.latest !== null ? copy.latest : null
  const pickYours = () => (onPick ? onPick('system') : void send('cli/system', { agent: provider }))
  const yours = <label className="settings__check">
    <input type="radio" name={name} checked={chosen === 'system'} disabled={!copy.system || busy || locked} onChange={pickYours} />
    {copy.system ? text.yours(copy.installed ?? null) : text.yoursMissing}
  </label>
  return <div className="cli-source">
    <div className="cli-source__options" role="radiogroup" aria-label={label ?? text.which}>
      {locked ? <Tipped tip={t.shared.cliLocked} focusable>{yours}</Tipped> : yours}
      <label className="settings__check">
        <input type="radio" name={name} checked={chosen === 'checked'} disabled={busy} onChange={() => checked.pick('checked')} />
        {copy.checkedStatus === 'ready' ? text.checkedReady(copy.version) : text.checkedOffer(copy.version, mb(copy.approximate))}
      </label>
      {latest && <label className="settings__check">
        <input type="radio" name={name} checked={chosen === 'latest'} disabled={busy || locked} onChange={() => checked.pick('latest')} />
        {latestReady !== null ? text.latestReady(latestReady) : text.latestOffer(mb(copy.approximate))}
      </label>}
    </div>
    {chosen === null && copy.status !== 'downloading' && (copy.installable ? <>
      {runs !== undefined && <p className="cli-source__lead">{text.installVia}</p>}
      <div className="cli-source__install">
        <CommandBlock command={runs ?? installCommand(provider, state.platform)} />
        <div className="cli-source__buttons">
          {runs !== undefined && <InstallButton install={install} busy={busy} onInstall={() => void send('account/installCli', { agent: provider })} />}
          <button type="button" className="button button--small" disabled={busy} onClick={() => void send('cli/check')}>{text.again}</button>
        </div>
      </div>
      {runs !== undefined && install !== null && <InstallOutput install={install} title={titleOf(provider)} />}
    </> : <p className="cli-source__empty">{text.noInstall}</p>)}
    {copy.status === 'downloading' && <div className="cli-copy"><CliProgress provider={provider} copy={copy} /></div>}
    {copy.status === 'failed' && <div className="cli-source__problem">
      <p className="notice notice--error">{say({ code: 'agent.copyFailed', params: { title: titleOf(provider) } })}</p>
      {download}
    </div>}
    {copy.source !== 'system' && source === copy.source && copy.status === 'missing' && <div className="cli-source__problem">
      <span>{text.missing}</span>
      {download}
    </div>}
    {(picked === 'checked' && copy.source !== 'checked' && copy.checkedStatus === 'missing' || picked === 'latest' && copy.source !== 'latest' && latestReady === null) && <p className="cli-source__state">{text.onSave}</p>}
    {[failure, checked.failure].map((each, index) => each && <p key={index} className="notice notice--error">{sayAtField(each)}</p>)}
    {checked.dialog}
  </div>
}
