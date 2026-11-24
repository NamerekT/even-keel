import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { EFFORTS } from '../../../src/agent/providers.js'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import { accountName } from '../accountName.js'
import { AgentIcon } from '../layout/accountParts.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { say, t } from '../i18n/index.js'
import { spanNames } from '../layout/Limits.js'
import { useNow } from '../layout/useNow.js'
import { Segmented } from '../stats/common.js'
import '../tools/addPackage.css'
import { useBackdropClose } from '../ui/backdrop.js'
import { ButtonWithTip } from '../ui/ButtonWithTip.js'
import { CloseIcon, InfoIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { TipFacts } from '../ui/TipFacts.js'
import { Tipped } from '../ui/Tipped.js'
import type { ChatRenewal } from './chatRenewal.js'
import { blockOf } from './NewChatDialog.js'
import { modelsReading, offersOf, useModelCatalog } from './useModels.js'
import './chats.css'

interface Props {
  chat: ChatCard
  /** The accounts of the chat's machine (`useChatAccounts`): the new session stays there. */
  accounts: AccountEntry[]
  renewal: ChatRenewal
  /** The user's message as the field holds it: its words, else the names of its files. */
  message: string
  /** The choice offered first (`renewalChoice`). */
  choice: ChatChoice
  busy: boolean
  failure?: Notice
  /** "Reply here": the message goes to this chat as usual; only for a cold cache. */
  onReply: () => void
  /** "New session with this message". */
  onRenew: (choice: ChatChoice) => Promise<void>
  /** Cancel: the text and the files stay in the field. */
  onClose: () => void
}

/**
 * Why the dialog asks, in a few words — when the cache went cold, which window is spent — with an "i" whose tip says
 * how much a reply rereads or when the window resets.
 */
export function RenewWhy({ renewal, now }: { renewal: ChatRenewal; now: Date }) {
  const text = t.chats.renew
  const [head, tip]: [string, ReactNode] =
    renewal.kind === 'cold'
      ? [text.cold(formatAgo(renewal.since, now)), renewal.tokens > 0 ? text.rereads(formatTokens(renewal.tokens)) : text.rereadsAll]
      : renewal.span !== null && renewal.resetsAt !== null
        ? [text.limit(spanNames(renewal.span).title), <TipFacts rows={[[t.limits.facts.resets, formatSpan(renewal.resetsAt, now)]]} />]
        : [text.limitBare, null]
  // The state of the chat, not a refusal: the limit's red is its own class, so a refusal stays the only red band.
  return (
    <p className={`notice renew-chat__why ${renewal.kind === 'cold' ? 'notice--warn' : 'renew-chat__why--limit'}`}>
      {tip === null ? (
        head
      ) : (
        <Tipped inline focusable align="start" tip={tip}>
          {head}
          <span className="renew-chat__info">
            <InfoIcon />
          </span>
        </Tipped>
      )}
    </p>
  )
}

/**
 * A message to a project chat whose cache went cold or whose account is at a limit (BTN-1232): one line of why, the
 * message quoted, the account, model and effort of the new session in one row; the rest in the main button's "?".
 */
export function ChatRenewDialog({ chat, accounts, renewal, message, choice, busy, failure, onReply, onRenew, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const now = useNow(30_000)
  const [account, setAccount] = useState(choice.account)
  const [model, setModel] = useState(choice.model ?? '')
  const [effort, setEffort] = useState(choice.effort ?? 'medium')
  const [quote] = useState(message)
  const entry = accounts.find((each) => each.key === account)
  const efforts = entry === undefined ? [] : (EFFORTS[entry.agent] ?? [])
  const shownEffort = efforts.includes(effort) ? effort : (efforts.find((each) => each === 'medium') ?? efforts[0] ?? '')
  const catalog = useModelCatalog(account === '' ? [] : [account])
  const chatEntry = accounts.find((each) => each.key === chat.account)
  const chatName = chatEntry === undefined ? chat.account : accountName(chatEntry, accounts)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    primary.current?.focus()
  }, [])

  const pick = (key: string) => {
    const next = accounts.find((each) => each.key === key)
    if (next === undefined || key === account) return
    if (next.agent !== entry?.agent) setModel('')
    setAccount(key)
  }

  const renew = async () => {
    if (entry === undefined || busy) return
    await onRenew({ account, model: model === '' ? null : model, effort: shownEffort === '' ? null : shownEffort })
  }

  const offers = offersOf(catalog, account)
  const models = [{ value: '', label: t.settings.cliDefault }, ...[...new Set([...offers, ...(model === '' ? [] : [model])])].map((each) => ({ value: each, label: each }))]
  const options = accounts.map((each) => {
    const blocked = each.key === account ? null : blockOf(each, now)
    // The agent is the option's icon: the row has no room for its name.
    return { value: each.key, label: accountName(each, accounts), icon: <AgentIcon agent={each.agent} />, ...(blocked === null ? {} : { unavailable: blocked }) }
  })
  const text = t.chats.renew

  return (
    <dialog
      ref={dialog}
      className="add-package renew-chat"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => event.stopPropagation()}
      {...backdrop}
    >
      <form
        className="add-package__frame"
        onSubmit={(event) => {
          event.preventDefault()
          void renew()
        }}
      >
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {renewal.kind === 'cold' ? text.coldTitle : text.limitTitle(chatName)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.cancel} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body renew-chat__body">
          <RenewWhy renewal={renewal} now={now} />
          <blockquote className="renew-chat__quote" aria-label={text.message}>
            {quote}
          </blockquote>
          <div className="renew-chat__fields">
            <Select className="add-package__input renew-chat__account" value={account} options={options} onChange={pick} label={t.chats.dialog.accounts} />
            <Select className="add-package__input renew-chat__model" value={model} options={models} onChange={setModel} label={t.chats.dialog.model} loading={modelsReading(catalog, account)} disabled={entry === undefined} />
            {efforts.length > 0 && (
              <Segmented label={t.chats.dialog.effort} options={efforts.map((each) => [each, each] as [string, string])} value={shownEffort} onChange={setEffort} />
            )}
          </div>
        </div>
        {failure && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        <footer className="add-package__foot add-package__foot--wrap">
          <button type="button" className="button" onClick={onClose}>
            {t.common.cancel}
          </button>
          {renewal.kind === 'cold' && (
            <button type="button" className="button" disabled={busy} onClick={onReply}>
              {text.reply}
            </button>
          )}
          <ButtonWithTip
            className="renew-chat__go"
            label={text.goHelp}
            tip={text.goTip}
            action={
              <button type="submit" ref={primary} className="button button--primary" disabled={entry === undefined || busy} aria-busy={busy ? true : undefined}>
                {text.go}
              </button>
            }
          />
        </footer>
      </form>
    </dialog>
  )
}
