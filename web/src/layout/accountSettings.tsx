import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { notice } from '../../../src/notice/notice.js'
import { accountName } from '../accountName.js'
import { say, t } from '../i18n/index.js'
import { Band } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { AgentIcon, type Send } from './accountParts.js'

const CHOICES = ['share', 'own', 'discard'] as const

/**
 * One row per key changed right in an account folder's `settings.json` since the last transfer (BTN-901): the change
 * is held there until a person shares it, keeps it for that account only or discards it.
 */
export function AccountSettingsEdits({ view, send, sending }: { view: AccountView; send: Send; sending: boolean }) {
  const edits = view.accounts.flatMap((entry) => (entry.settingsEdits ?? []).map((key) => ({ entry, key })))
  if (edits.length === 0) return null
  return <Band tone="warn" className="account-problems account-settings-edits">
    {edits.map(({ entry, key }) => <div className="account-problems__row" key={`${entry.key}:${key}`}>
      <AgentIcon agent={entry.agent} />
      <div className="account-problems__text">{say(notice('account.settingsEdited', { account: accountName(entry, view.accounts), key }))}</div>
      <div className="account-problems__actions">
        {CHOICES.map((choice) => <Tipped key={choice} tip={t.account.settingsEdit[`${choice}Tip`]} align="start">
          <button type="button" className="button button--small" disabled={sending}
            onClick={() => void send('account/settings-edit', { account: entry.key, key, choice })}>{t.account.settingsEdit[choice]}</button>
        </Tipped>)}
      </div>
    </div>)}
  </Band>
}

/** The keys of the account's own layer, each with a × that brings the shared value back (BTN-901). */
export function OwnSettings({ entry, send, sending }: { entry: AccountEntry; send: Send; sending: boolean }) {
  const keys = entry.ownSettings ?? []
  if (keys.length === 0) return null
  return <div className="account-own">
    <Tipped inline focusable tip={t.account.ownSettingsTip} align="start">{t.account.ownSettings}</Tipped>
    {keys.map((key) => <span key={key} className="tag account-own__key">{key}
      <button type="button" className="account-own__drop" aria-label={t.account.dropOwnSetting(key)} title={t.account.dropOwnSetting(key)} disabled={sending}
        onClick={() => void send('account/own-setting', { account: entry.key, key })}>×</button>
    </span>)}
  </div>
}
