import { useEffect, useState } from 'react'
import type { AccountEntry, AccountView, SettingsEdit } from '../../../src/account/model.js'
import { notice } from '../../../src/notice/notice.js'
import { accountName } from '../accountName.js'
import { say, t } from '../i18n/index.js'
import { Band } from '../ui/blocks.js'
import { FoldList } from '../ui/Fold.js'
import { CloseIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { AgentIcon, type Send } from './accountParts.js'
import './accountSettings.css'

const CHOICES = ['share', 'own', 'discard'] as const

type Choice = (typeof CHOICES)[number]

/** An edit by its value too: the same key changed again after a choice is a new row. */
const editId = (account: string, edit: SettingsEdit) => `${account}\n${JSON.stringify(edit)}`

/**
 * One band per account whose `settings.json` was changed right in its folder since the last transfer (BTN-901,
 * BTN-1395): a row per key with what it was and is now and its own three choices, and the same choices for all
 * rows at once in the head. A chosen row leaves at once; the band, with its last row.
 */
export function AccountSettingsEdits({ view, send, sending }: { view: AccountView; send: Send; sending: boolean }) {
  const [hidden, setHidden] = useState<readonly string[]>([])
  const present = view.accounts.flatMap((entry) => (entry.settingsEdits ?? []).map((edit) => editId(entry.key, edit)))
  const presentKey = present.join('\0')
  useEffect(() => setHidden((ids) => (ids.every((id) => present.includes(id)) ? ids : ids.filter((id) => present.includes(id)))), [presentKey])

  const resolve = async (entry: AccountEntry, edits: SettingsEdit[], choice: Choice) => {
    const ids = edits.map((edit) => editId(entry.key, edit))
    setHidden((old) => [...old, ...ids])
    const body = edits.length === 1 ? { key: edits[0]!.key } : { keys: edits.map((edit) => edit.key) }
    if (!(await send('account/settings-edit', { account: entry.key, ...body, choice }))) setHidden((old) => old.filter((id) => !ids.includes(id)))
  }

  const bands = view.accounts.flatMap((entry) => {
    const edits = (entry.settingsEdits ?? []).filter((edit) => !hidden.includes(editId(entry.key, edit)))
    if (edits.length === 0) return []
    return [{ key: entry.key, children: <Band tone="warn" className="account-settings-edits">
      <div className="account-settings-edits__row">
        <AgentIcon agent={entry.agent} />
        <div className="account-settings-edits__text">{say(notice('account.settingsEdited', { account: accountName(entry, view.accounts), count: edits.length }))}</div>
        {edits.length > 1 && <div className="account-settings-edits__actions">
          {CHOICES.map((choice) => <Tipped key={choice} tip={t.account.settingsEdit.all[`${choice}Tip`]} align="start">
            <button type="button" className="button button--small" disabled={sending} onClick={() => void resolve(entry, edits, choice)}>
              {t.account.settingsEdit.all[choice]}
            </button>
          </Tipped>)}
        </div>}
      </div>
      <div className="account-edits">
        <div className="account-edits__head" aria-hidden>
          <span>{t.account.settingsEdit.key}</span><span>{t.account.settingsEdit.was}</span><span>{t.account.settingsEdit.now}</span>
          <span className="account-edits__actions account-edits__ghost" inert>
            {CHOICES.map((choice) => <span key={choice} className="button button--small">{t.account.settingsEdit[choice]}</span>)}
          </span>
        </div>
        <FoldList items={edits.map((edit) => ({ key: edit.key, children: <EditRow edit={edit} sending={sending} onChoose={(choice) => void resolve(entry, [edit], choice)} /> }))} />
      </div>
    </Band> }]
  })
  return <FoldList items={bands} className="account-settings-bands" />
}

function EditRow({ edit, sending, onChoose }: { edit: SettingsEdit; sending: boolean; onChoose: (choice: Choice) => void }) {
  const vars = edit.variables
  return <div className="account-edits__row">
    <span className="account-edits__key">{vars === undefined ? edit.key
      : <Tipped inline focusable tip={t.account.settingsEdit.variablesTip} align="start">{edit.key}</Tipped>}</span>
    {vars === undefined
      ? <><Value label={t.account.settingsEdit.was} text={edit.was} /><Value label={t.account.settingsEdit.now} text={edit.now} /></>
      : <><Names label={t.account.settingsEdit.was} names={[...vars.removed, ...vars.changed].sort()} /><Names label={t.account.settingsEdit.now} names={[...vars.added, ...vars.changed].sort()} /></>}
    <span className="account-edits__actions">
      {CHOICES.map((choice) => <Tipped key={choice} tip={t.account.settingsEdit[`${choice}Tip`]} align="start">
        <button type="button" className="button button--small" disabled={sending} onClick={() => onChoose(choice)}>{t.account.settingsEdit[choice]}</button>
      </Tipped>)}
    </span>
  </div>
}

/** A plain string without its JSON quotes: `"sonnet"` reads as sonnet. */
function plain(json: string): string {
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'string' ? value : json
  } catch {
    return json
  }
}

function Value({ label, text: json }: { label: string; text: string | undefined }) {
  if (json === undefined) return <span className="account-edits__value account-edits__value--unset" data-label={label}>{t.account.settingsEdit.unset}</span>
  const text = plain(json)
  return <span className="account-edits__value" data-label={label}>
    <Tipped inline focusable tip={<code className="account-edits__full">{text}</code>} align="start" className="account-edits__text">{text}</Tipped>
  </span>
}

function Names({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return <span className="account-edits__value account-edits__value--unset" data-label={label}>{t.account.settingsEdit.unset}</span>
  return <span className="account-edits__value account-edits__names" data-label={label}>{names.map((name) => <span key={name} className="tag">{name}</span>)}</span>
}

/** The keys of the account's own layer, each with a × that brings the shared value back (BTN-901). */
export function OwnSettings({ entry, send, sending }: { entry: AccountEntry; send: Send; sending: boolean }) {
  const keys = entry.ownSettings ?? []
  if (keys.length === 0) return null
  return <div className="account-own">
    <Tipped inline focusable tip={t.account.ownSettingsTip} align="start">{t.account.ownSettings}</Tipped>
    {keys.map((key) => <span key={key} className="tag account-own__key">{key}
      <button type="button" className="account-own__drop" aria-label={t.account.dropOwnSetting(key)} title={t.account.dropOwnSetting(key)} disabled={sending}
        onClick={() => void send('account/own-setting', { account: entry.key, key })}><CloseIcon /></button>
    </span>)}
  </div>
}
