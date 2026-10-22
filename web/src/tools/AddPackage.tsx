import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PackagesView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { HelpTip } from '../pages/settingsParts.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { PlugIcon, PlusIcon, ServerIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { serverEntry, serverPairs, type Transport } from './packageView.js'
import './addPackage.css'

type Kind = 'plugin' | 'mcp'

const EXAMPLES: Record<Transport, string> = { http: 'Authorization: Bearer ${API_TOKEN}', stdio: 'API_URL=https://api.example.com' }

/** "Add a package": a dialog that asks for the kind first, then for that kind's fields. */
export function AddPackage({ view, projects }: { view: PackagesView; projects: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="button button--small packages__add" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <PlusIcon />
        {t.packages.addOpen}
      </button>
      {open && createPortal(<AddDialog view={view} projects={projects} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

/** The plugin step on a chosen plugin and project, from a link (`/tools?add=`); while Claude Code does not know Even Keel's marketplace, it asks to add it first. */
export function AddPlugin({ view, projects, plugin, project, onClose }: { view: PackagesView; projects: string[]; plugin: string; project: string; onClose: () => void }) {
  return createPortal(<AddDialog view={view} projects={projects} initial={{ plugin, project }} onClose={onClose} />, document.body)
}

interface Initial {
  plugin: string
  project: string
}

function AddDialog({ view, projects, initial, onClose }: { view: PackagesView; projects: string[]; initial?: Initial; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const [kind, setKind] = useState<Kind | null>(initial === undefined ? null : 'plugin')
  const [asking, setAsking] = useState(initial !== undefined && view.marketplace?.known === false)
  const title = useId()

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  // The pressed choice or Back leaves with its step: the focus goes to the first control of the new one.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('.add-package__kinds button, .add-package__body :is(input, textarea, button):not(.help), .add-package__foot .button--primary')?.focus()
  }, [kind, asking])

  const steps = { view, projects, initial, onBack: () => setKind(null), onClose }
  return (
    <dialog
      ref={dialog}
      className="add-package"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {asking ? t.packages.marketplaceAsk : kind === null ? t.packages.addOpen : t.packages.addKind[kind].title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={onClose}>
            ×
          </button>
        </header>
        {asking && view.marketplace !== null ? (
          <MarketplaceStep name={view.marketplace.name} onDone={() => setAsking(false)} />
        ) : (
          <>
            {kind === null && <KindStep onPick={setKind} />}
            {kind === 'plugin' && <PluginStep {...steps} />}
            {kind === 'mcp' && <ServerStep {...steps} />}
          </>
        )}
      </div>
    </dialog>
  )
}

function KindStep({ onPick }: { onPick: (kind: Kind) => void }) {
  const icons: Record<Kind, ReactNode> = { plugin: <PlugIcon />, mcp: <ServerIcon /> }
  return (
    <div className="add-package__kinds">
      {(['plugin', 'mcp'] as const).map((kind) => (
        <button key={kind} type="button" className="add-package__kind" onClick={() => onPick(kind)}>
          <span className="add-package__kind-icon">{icons[kind]}</span>
          <span className="add-package__kind-title">{t.packages.addKind[kind].title}</span>
          <span className="add-package__kind-hint">{t.packages.addKind[kind].hint}</span>
        </button>
      ))}
    </div>
  )
}

/** Chain sessions get Even Keel's plugins without the marketplace; either answer goes on to the plugin. */
function MarketplaceStep({ name, onDone }: { name: string; onDone: () => void }) {
  const { send, sending, failure } = useCommand()
  return (
    <div className="add-package__form">
      <div className="add-package__body">
        <p className="add-package__question">{t.packages.marketplaceQuestion(name)}</p>
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </div>
      <footer className="add-package__foot">
        <span className="add-package__spacer" />
        <button type="button" className="button" onClick={onDone}>
          {t.packages.marketplaceNo}
        </button>
        <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('packages/marketplace', {}).then((done) => done && onDone())}>
          {t.packages.marketplaceYes}
        </button>
      </footer>
    </div>
  )
}

interface StepProps {
  view: PackagesView
  projects: string[]
  initial?: Initial
  onBack: () => void
  onClose: () => void
}

function PluginStep({ view, projects, initial, onBack, onClose }: StepProps) {
  const { send, sending, failure } = useCommand()
  const names = view.available.map((each) => `${each.plugin}@${each.marketplace}`)
  const [picked, setPicked] = useState(initial !== undefined && names.includes(initial.plugin) ? initial.plugin : (names[0] ?? ''))
  const [where, setWhere] = useState(initial?.project ?? '')
  const found = view.available.find((each) => `${each.plugin}@${each.marketplace}` === picked)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (found !== undefined && (await send('packages/plugin', { ...found, project: where || undefined }))) onClose()
  }

  return (
    <StepForm failure={failure} ready={found !== undefined && !sending} onSubmit={submit} onBack={onBack} onClose={onClose}>
      {names.length === 0 ? (
        <p className="add-package__empty">{t.packages.noAvailable}</p>
      ) : (
        <>
          <Field label={t.packages.plugin}>
            {(id) => (
              <Select
                id={id}
                className="add-package__input"
                value={picked}
                options={view.available.map((each, index) => ({ value: names[index]!, label: `${each.plugin} · ${each.marketplace}` }))}
                onChange={setPicked}
                search={{ placeholder: t.packages.pluginSearch, none: t.packages.pluginNone }}
              />
            )}
          </Field>
          <WhereField projects={projects} value={where} onChange={setWhere} />
        </>
      )}
    </StepForm>
  )
}

function ServerStep({ projects, onBack, onClose }: StepProps) {
  const { send, sending, failure } = useCommand()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<Transport>('http')
  const [target, setTarget] = useState('')
  const [pairs, setPairs] = useState('')
  const [where, setWhere] = useState('')
  const entry = serverEntry(transport, target, pairs)
  const pairsWrong = serverPairs(transport, pairs) === null
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (entry !== null && (await send('packages/server', { name: name.trim(), server: entry, project: where || undefined }))) onClose()
  }
  const http = transport === 'http'

  return (
    <StepForm failure={failure} ready={name.trim() !== '' && entry !== null && !sending} onSubmit={submit} onBack={onBack} onClose={onClose}>
      <Field label={t.packages.serverName} hint={t.packages.serverNameHint}>
        {(id) => (
          <input
            id={id}
            className="add-package__input add-package__input--mono"
            value={name}
            placeholder="docs"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <fieldset className="add-package__field">
        <legend className="add-package__label add-package__legend">{t.packages.transport}</legend>
        <div className="add-package__switch">
          {(['http', 'stdio'] as const).map((each) => (
            <label key={each} className="add-package__option">
              <input type="radio" name="transport" value={each} checked={transport === each} onChange={() => setTransport(each)} />
              {t.packages.transports[each]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={http ? t.packages.serverUrl : t.packages.serverCommand} hint={http ? t.packages.serverUrlHint : t.packages.serverCommandHint}>
        {(id) => (
          <input
            id={id}
            className="add-package__input add-package__input--mono"
            value={target}
            placeholder={http ? 'https://mcp.example.com/mcp' : 'npx -y @scope/server@1'}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTarget(event.target.value)}
          />
        )}
      </Field>
      <Field label={http ? t.packages.headers : t.packages.env} hint={t.packages.pairsHint(EXAMPLES[transport])} error={pairsWrong ? t.packages.pairsInvalid(EXAMPLES[transport]) : undefined}>
        {(id) => (
          <textarea
            id={id}
            className="add-package__input add-package__input--mono"
            rows={3}
            value={pairs}
            placeholder={EXAMPLES[transport]}
            aria-invalid={pairsWrong}
            spellCheck={false}
            onChange={(event) => setPairs(event.target.value)}
          />
        )}
      </Field>
      <WhereField projects={projects} value={where} onChange={setWhere} />
    </StepForm>
  )
}

function WhereField({ projects, value, onChange }: { projects: string[]; value: string; onChange: (value: string) => void }) {
  const options = [{ value: '', label: t.packages.whereAll }, ...projects.map((project) => ({ value: project, label: t.packages.whereOne(project) }))]
  return (
    <Field label={t.packages.where} hint={t.packages.whereHint}>
      {(id) => <Select id={id} className="add-package__input" value={value} options={options} onChange={onChange} />}
    </Field>
  )
}

/** A label with its help behind a tip, the control, and the error under it when there is one. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="add-package__field">
      <span className="add-package__label-row">
        <label className="add-package__label" htmlFor={id}>
          {label}
        </label>
        {hint !== undefined && <HelpTip text={hint} align="start" />}
      </span>
      {children(id)}
      {error !== undefined && <span className="add-package__error">{error}</span>}
    </div>
  )
}

interface StepFormProps {
  failure: ReturnType<typeof useCommand>['failure']
  ready: boolean
  onSubmit: (event: FormEvent) => Promise<void>
  onBack: () => void
  onClose: () => void
  children: ReactNode
}

/** The fields of a kind, the failure of the last try, and Back · Cancel · Add level at the bottom. */
function StepForm({ failure, ready, onSubmit, onBack, onClose, children }: StepFormProps) {
  return (
    <form className="add-package__form" onSubmit={(event) => void onSubmit(event)}>
      <div className="add-package__body">
        {children}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </div>
      <footer className="add-package__foot">
        <button type="button" className="button" onClick={onBack}>
          ← {t.packages.back}
        </button>
        <span className="add-package__spacer" />
        <button type="button" className="button" onClick={onClose}>
          {t.packages.cancel}
        </button>
        <button type="submit" className="button button--primary" disabled={!ready}>
          {t.packages.add}
        </button>
      </footer>
    </form>
  )
}
