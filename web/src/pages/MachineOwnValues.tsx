import { useEffect, useId, useState } from 'react'
import type { MachineProjectSettings, PoolMachine, ProjectPool } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { FieldHead, Section } from './settingsParts.js'

type Command = 'beforeStart' | 'check' | 'afterGreen'
const COMMANDS: Command[] = ['beforeStart', 'check', 'afterGreen']

/** The form's text: a command list a line a command, a server's command and its arguments a line each. */
interface Draft {
  lists: Record<Command, string>
  servers: Record<string, { command: string; args: string }>
}

const lines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
const serverKey = (pkg: string, server: string) => `${pkg}\u0000${server}`

/** A package's MCP server by the package's name, and the server's in a tag beside it where the two differ (BTN-1381). */
export function ServerName({ pkg, server }: { pkg: string; server: string }) {
  return (
    <span className="machine-own__name">
      {pkg}
      {server !== pkg && <span className="tag">{server}</span>}
    </span>
  )
}

export function draftOf(settings: MachineProjectSettings, servers: ProjectPool['servers']): Draft {
  const lists = Object.fromEntries(COMMANDS.map((key) => [key, (settings[key] ?? []).join('\n')])) as Record<Command, string>
  const entries = servers.map((each) => {
    const own = settings.servers?.[each.package]?.[each.server]
    return [serverKey(each.package, each.server), { command: own?.command ?? '', args: (own?.args ?? []).join('\n') }] as const
  })
  return { lists, servers: Object.fromEntries(entries) }
}

/** What the form saves: a list or a field left blank is the project's and is left out. */
export function settingsOf(draft: Draft, servers: ProjectPool['servers']): MachineProjectSettings {
  const result: MachineProjectSettings = {}
  for (const key of COMMANDS) {
    const list = lines(draft.lists[key])
    if (list.length > 0) result[key] = list
  }
  for (const each of servers) {
    const own = draft.servers[serverKey(each.package, each.server)]
    if (own === undefined) continue
    const command = own.command.trim()
    const args = lines(own.args)
    if (command === '' && args.length === 0) continue
    result.servers ??= {}
    result.servers[each.package] ??= {}
    result.servers[each.package]![each.server] = { ...(command !== '' && { command }), ...(args.length > 0 && { args }) }
  }
  return result
}

/**
 * A machine elsewhere's own values in the project (BTN-994, `docs/settings.md`, "A machine in a project"): its command
 * lists and the commands of the project's stdio servers there. A field left blank shows the project's value as its
 * placeholder and takes it.
 */
export function MachineOwnValues({ project, row, pool, onSaved }: { project: string; row: PoolMachine; pool: ProjectPool; onSaved: () => void }) {
  const own = t.machinePanel.view.own
  const id = useId()
  const { send, sending, failure } = useCommand()
  const saved = draftOf(row.settings, pool.servers)
  const [draft, setDraft] = useState(saved)
  const savedText = JSON.stringify(saved)
  // A save or another page's edit brought new values: the form starts from them.
  useEffect(() => setDraft(JSON.parse(savedText) as Draft), [savedText])
  const changed = JSON.stringify(draft) !== savedText
  const projectLists = pool.commands
  const placeholder = (key: Command) => (projectLists !== undefined && projectLists[key].length > 0 ? projectLists[key].join('\n') : own.none)
  const save = async () => {
    if (await send('machines/settings', { project, machine: row.id, settings: settingsOf(draft, pool.servers) })) onSaved()
  }
  return (
    <Section title={own.title} hint={own.hint}>
      {COMMANDS.map((key) => (
        <div key={key} className="settings__field">
          <FieldHead label={own.lists[key]} hint={own.listHint} htmlFor={`${id}-${key}`} />
          <textarea
            id={`${id}-${key}`}
            className="settings__text settings__text--mono"
            rows={3}
            spellCheck={false}
            value={draft.lists[key]}
            placeholder={placeholder(key)}
            onChange={(event) => setDraft({ ...draft, lists: { ...draft.lists, [key]: event.target.value } })}
          />
        </div>
      ))}
      {pool.servers.length > 0 && (
        <div className="machine-own__servers">
          <FieldHead label={own.servers} hint={own.serversHint} />
          {pool.servers.map((each) => {
            const key = serverKey(each.package, each.server)
            const value = draft.servers[key] ?? { command: '', args: '' }
            const put = (patch: Partial<typeof value>) => setDraft({ ...draft, servers: { ...draft.servers, [key]: { ...value, ...patch } } })
            return (
              <div key={key} className="machine-own__server">
                <ServerName pkg={each.package} server={each.server} />
                <label className="machine-own__part">
                  <span className="settings__label">{own.command}</span>
                  <input className="settings__text settings__text--mono" autoComplete="off" spellCheck={false} value={value.command} placeholder={each.command} onChange={(event) => put({ command: event.target.value })} />
                </label>
                <label className="machine-own__part">
                  <span className="settings__label">{own.args}</span>
                  <textarea className="settings__text settings__text--mono" rows={2} spellCheck={false} value={value.args} placeholder={each.args.join('\n') || own.noArgs} onChange={(event) => put({ args: event.target.value })} />
                </label>
              </div>
            )
          })}
        </div>
      )}
      {failure !== null && (
        <p role="alert" className="notice notice--error">
          {say(failure)}
        </p>
      )}
      <div className="machine-own__foot">
        <button type="button" className="button" disabled={!changed || sending} onClick={() => setDraft(saved)}>
          {own.reset}
        </button>
        <button type="button" className="button button--primary" disabled={!changed || sending} aria-busy={sending || undefined} onClick={() => void save()}>
          {own.save}
        </button>
      </div>
    </Section>
  )
}
