import { useState, type FormEvent } from 'react'
import type { KeyView, PackagesView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { HelpTip } from '../pages/settingsParts.js'
import { Tipped } from '../ui/Tipped.js'
import { importOffers, marketplaceCommand, type Dismissed } from './packageView.js'

const DISMISSED_KEY = 'even-keel.packages.imports'

function readDismissed(): Dismissed {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? (raw as Dismissed) : {}
  } catch {
    return {}
  }
}

/** The servers of a repository's committed `.mcp.json` the catalog does not have; a dismissal holds until the list changes. */
export function ImportOffers({ view, projects }: { view: PackagesView; projects: string[] }) {
  const { send, sending, failure } = useCommand()
  const [dismissed, setDismissed] = useState(readDismissed)
  const offers = importOffers(view, projects, dismissed)
  if (offers.length === 0) return null

  const dismiss = (project: string, servers: string[]) => {
    const next = { ...dismissed, [project]: servers.join(',') }
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    setDismissed(next)
  }

  return (
    <div className="packages__offers">
      {offers.map(({ project, servers }) => (
        <div key={project} className="packages__offer">
          <span>{t.packages.import(project, servers.join(', '))}</span>
          <HelpTip text={t.packages.importTip} />
          <button type="button" className="button button--small button--primary" disabled={sending} onClick={() => void send('packages/import', { project })}>
            {t.packages.importAdd}
          </button>
          <button type="button" className="button button--small" onClick={() => dismiss(project, servers)}>
            {t.packages.importDismiss}
          </button>
        </div>
      ))}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

const MARKETPLACE_DISMISSED_KEY = 'even-keel.packages.marketplace'

/** Claude Code does not know Even Keel's marketplace: the command for sessions started by hand, and a button that runs it. */
export function MarketplaceOffer({ view }: { view: PackagesView }) {
  const { send, sending, failure } = useCommand()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(MARKETPLACE_DISMISSED_KEY))
  const own = view.marketplace
  if (own === null || own.known || dismissed === own.name) return null

  const dismiss = () => {
    localStorage.setItem(MARKETPLACE_DISMISSED_KEY, own.name)
    setDismissed(own.name)
  }

  return (
    <div className="packages__offers">
      <div className="packages__offer">
        <span>{t.packages.marketplace(own.name)}</span>
        <HelpTip text={t.packages.marketplaceTip} />
        <code className="packages__command">{marketplaceCommand(own.dir)}</code>
        <button type="button" className="button button--small button--primary" disabled={sending} onClick={() => void send('packages/marketplace', {})}>
          {t.packages.marketplaceAdd}
        </button>
        <button type="button" className="button button--small" onClick={dismiss}>
          {t.packages.importDismiss}
        </button>
      </div>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

export function Keys({ view }: { view: PackagesView }) {
  if (view.keys.length === 0) return null
  return (
    <div className="packages__block">
      <span className="packages__block-title">
        {t.packages.keys}
        <HelpTip text={t.packages.keysTip} />
      </span>
      <ul className="packages__keys">
        {view.keys.map((key) => (
          <KeyRow key={key.name} entry={key} />
        ))}
      </ul>
    </div>
  )
}

function KeyRow({ entry }: { entry: KeyView }) {
  const { send, sending, failure } = useCommand()
  const [value, setValue] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('packages/key', { name: entry.name, value })) setValue('')
  }
  const readers = entry.packages.length === 0 ? t.packages.keyTracker : entry.packages.join(', ')

  return (
    <li className="packages__key">
      <Tipped className="packages__key-name" tip={t.packages.keyReads(readers)} focusable inline>
        <code>{entry.name}</code>
      </Tipped>
      <span className={entry.set ? 'tools__chip tools__chip--on' : 'tools__chip tools__chip--lost'}>{entry.set ? t.packages.keySet : t.packages.keyUnset}</span>
      <form className="packages__key-form" onSubmit={(event) => void submit(event)}>
        <input
          className="packages__input"
          type="password"
          value={value}
          placeholder={t.packages.keyValue(entry.name)}
          aria-label={t.packages.keyValue(entry.name)}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="button button--small" disabled={sending || value === ''}>
          {t.packages.keySave}
        </button>
      </form>
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
    </li>
  )
}
