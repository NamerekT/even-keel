import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import { accountName } from '../accountName.js'
import { formatAgo, formatSpan, formatTokens } from '../format.js'
import { say, t } from '../i18n/index.js'
import { spanNames } from '../layout/Limits.js'
import '../tools/addPackage.css'
import { useBackdropClose } from '../ui/backdrop.js'
import { ButtonWithTip } from '../ui/ButtonWithTip.js'
import { CloseIcon, InfoIcon } from '../ui/icons.js'
import { TipFacts } from '../ui/TipFacts.js'
import { Tipped } from '../ui/Tipped.js'
import { sameAsChat, type ChatRenewal } from './chatRenewal.js'
import { ChatChoiceForm, useChatChoice } from './ChatChoiceForm.js'
import './chats.css'

interface Props {
  chat: ChatCard
  /** The accounts of the chat's machine (`useChatAccounts`): the chat's own is named in the title of a limit. */
  accounts: AccountEntry[]
  /** Why a message asks; absent — the ⋯ menu's early continue (BTN-1776): no message, no why, no "Reply here". */
  renewal?: ChatRenewal
  /** The user's message as the field holds it: its words, else the names of its files. */
  message?: string
  /** The choice offered first (`renewalChoice`; the chat's own for an early continue), the chat's machine in it. */
  choice: ChatChoice
  busy: boolean
  failure?: Notice
  /** "Reply here": the message goes to this chat as usual; only for a cold cache. */
  onReply?: () => void
  /** "New session with this message" or, early, "Continue", on the machine picked. */
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
 * A message to a project chat whose cache went cold or whose account is at a limit (BTN-1232): one line of why and the
 * message quoted, then the form of "New session" (`ChatChoiceForm`, BTN-1711) — the machine, the accounts by agent
 * with their limits, the model and the effort; the rest in the main button's "?". Without a renewal it is the early
 * continue of the ⋯ menu (BTN-1776): the form alone, its button quiet while the pick is what the chat runs on.
 */
export function ChatRenewDialog({ chat, accounts, renewal, message = '', choice, busy, failure, onReply, onRenew, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const reason = useId()
  const form = useChatChoice(chat.project, choice, accounts.find((each) => each.key === choice.account)?.agent)
  const { pick } = form
  const [quote] = useState(message)
  const chatEntry = accounts.find((each) => each.key === chat.account)
  const chatName = chatEntry === undefined ? chat.account : accountName(chatEntry, accounts)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    primary.current?.focus()
  }, [])

  const same = renewal === undefined && sameAsChat(chat, { ...pick, account: pick.account?.key }, form.efforts)

  const renew = async () => {
    if (pick.account === undefined || busy || same) return
    await onRenew({
      account: pick.account.key,
      model: pick.model === '' ? null : pick.model,
      effort: pick.effort === '' ? null : pick.effort,
      ...(pick.machine !== null && { machine: pick.machine }),
    })
  }

  const text = t.chats.renew

  return (
    <dialog
      ref={dialog}
      className="add-package new-chat renew-chat"
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
            {renewal === undefined ? text.earlyTitle : renewal.kind === 'cold' ? text.coldTitle : text.limitTitle(chatName)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.cancel} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <ChatChoiceForm
          project={chat.project}
          state={form}
          lead={
            renewal !== undefined && (
              <>
                <RenewWhy renewal={renewal} now={form.now} />
                <blockquote className="renew-chat__quote" aria-label={text.message}>
                  {quote}
                </blockquote>
              </>
            )
          }
        />
        {failure && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        <footer className="add-package__foot add-package__foot--wrap">
          {same && (
            <span id={reason} className="renew-chat__reason">
              {form.machines.length > 0 ? text.same : text.sameHere}
            </span>
          )}
          <button type="button" className="button renew-chat__cancel" onClick={onClose}>
            {t.common.cancel}
          </button>
          {renewal?.kind === 'cold' && onReply !== undefined && (
            <button type="button" className="button" disabled={busy} onClick={onReply}>
              {text.reply}
            </button>
          )}
          <ButtonWithTip
            className={`renew-chat__go${same ? ' renew-chat__go--quiet' : ''}`}
            label={text.goHelp}
            tip={renewal === undefined ? text.earlyTip : text.goTip}
            action={
              <button
                type="submit"
                ref={primary}
                className="button button--primary"
                disabled={pick.account === undefined || busy}
                aria-disabled={same || undefined}
                aria-describedby={same ? reason : undefined}
                aria-busy={busy ? true : undefined}
              >
                {renewal === undefined ? text.earlyGo : text.go}
              </button>
            }
          />
        </footer>
      </form>
    </dialog>
  )
}
