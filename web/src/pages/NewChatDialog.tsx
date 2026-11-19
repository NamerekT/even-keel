import { useEffect, useId, useRef, useState } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { EFFORTS } from '../../../src/agent/providers.js'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import { limitSpans } from '../../../src/limits/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { accountName, agentLabel } from '../accountName.js'
import { accountGroups, tightestWindow } from '../accounts.js'
import { formatSpan, formatStamp } from '../format.js'
import { say, t } from '../i18n/index.js'
import { AgentIcon } from '../layout/accountParts.js'
import { spanNames } from '../layout/Limits.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { Segmented } from '../stats/common.js'
import '../tools/addPackage.css'
import { useBackdropClose } from '../ui/backdrop.js'
import { Select } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { HelpTip } from './settingsParts.js'
import { modelsReading, offersOf, useModelCatalog } from './useModels.js'
import './chats.css'

interface Props {
  project: string
  /** The project's last choice, offered first. */
  choice: ChatChoice | null
  onClose: () => void
  /** The chat is made: its window opens with an empty field. */
  onStarted: (chat: ChatCard) => void
}

/** An account on a limit or waiting for a sign-in cannot start a chat: why, and until when for a limit. */
function blockOf(entry: AccountEntry, now: Date): string | null {
  if (entry.needsLogin) return t.chats.dialog.login
  const tightest = tightestWindow(entry.limits)
  return tightest !== null && tightest.free === 0 ? t.chats.dialog.limit(formatStamp(tightest.window.resetsAt, now)) : null
}

/**
 * The window of a new project chat (BTN-1231): the accounts by agent with their limits, then the model and the effort,
 * which stay for the whole chat. "Start chat" makes the chat; its session starts with the first message.
 */
export function NewChatDialog({ project, choice, onClose, onStarted }: Props) {
  const { state, query } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const now = useNow(30_000)
  const view = state?.account
  const groups = view === undefined ? [] : accountGroups(view, now)
  const open = groups.flatMap((group) => group.entries).filter((entry) => blockOf(entry, now) === null)
  const first = open.find((entry) => entry.key === choice?.account) ?? open[0]
  const [account, setAccount] = useState(first?.key ?? '')
  const [model, setModel] = useState(first !== undefined && first.key === choice?.account ? (choice.model ?? '') : '')
  const entry = view?.accounts.find((each) => each.key === account)
  const efforts = entry === undefined ? [] : (EFFORTS[entry.agent] ?? [])
  const [effort, setEffort] = useState(choice?.effort ?? 'medium')
  const catalog = useModelCatalog(account === '' ? [] : [account])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const shownEffort = efforts.includes(effort) ? effort : (efforts.find((each) => each === 'medium') ?? efforts[0] ?? '')

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const pick = (next: AccountEntry) => {
    if (next.key === account) return
    setAccount(next.key)
    if (next.agent !== entry?.agent) setModel('')
  }

  const start = async () => {
    if (entry === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const chat = await query<ChatCard>('chats/create', { project, account, model: model === '' ? null : model, effort: shownEffort === '' ? null : shownEffort })
      onStarted(chat)
    } catch (reason) {
      setFailure(noticeOf(reason))
      setBusy(false)
    }
  }

  const offers = offersOf(catalog, account)
  const models = [{ value: '', label: t.settings.cliDefault }, ...[...new Set([...offers, ...(model === '' ? [] : [model])])].map((each) => ({ value: each, label: each }))]

  return (
    <dialog
      ref={dialog}
      className="add-package new-chat"
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
          void start()
        }}
      >
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {t.chats.dialog.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.chats.dialog.cancel} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body new-chat__body">
          {groups.length === 0 || open.length === 0 ? <p className="notice notice--warn">{t.chats.dialog.none}</p> : null}
          <div role="radiogroup" aria-label={t.chats.dialog.accounts} className="new-chat__groups">
            {groups.map((group) => (
              <section key={group.agent} className="new-chat__group">
                <h3 className="new-chat__agent">
                  <AgentIcon agent={group.agent} />
                  {agentLabel(group.agent)}
                </h3>
                {group.entries.map((each) => {
                  const blocked = blockOf(each, now)
                  const picked = each.key === account
                  return (
                    <label key={each.key} className={`new-chat__pick${picked ? ' new-chat__pick--on' : ''}${blocked === null ? '' : ' new-chat__pick--off'}`}>
                      <input type="radio" name="account" value={each.key} checked={picked} disabled={blocked !== null} onChange={() => pick(each)} />
                      <span className="new-chat__name">
                        <span className="new-chat__who">{accountName(each, view?.accounts)}</span>
                        {each.projects.includes(project) && (
                          <Tipped inline tip={t.chats.dialog.chainTip}>
                            <span className="tag new-chat__chain">{t.chats.dialog.chain}</span>
                          </Tipped>
                        )}
                      </span>
                      {blocked !== null ? <span className="new-chat__blocked">{blocked}</span> : <Bars entry={each} now={now} />}
                    </label>
                  )
                })}
              </section>
            ))}
          </div>
          <div className="new-chat__fields">
            <div className="new-chat__field">
              <span className="new-chat__label">{t.chats.dialog.model}</span>
              <Select className="add-package__input" value={model} options={models} onChange={setModel} label={t.chats.dialog.model} loading={modelsReading(catalog, account)} disabled={entry === undefined} />
            </div>
            {efforts.length > 0 && (
              <div className="new-chat__field">
                <span className="new-chat__label">
                  {t.chats.dialog.effort}
                  <HelpTip text={t.chats.dialog.effortTip} />
                </span>
                <Segmented label={t.chats.dialog.effort} options={efforts.map((each) => [each, each] as [string, string])} value={shownEffort} onChange={setEffort} />
              </div>
            )}
          </div>
        </div>
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        <footer className="add-package__foot">
          <button type="button" className="button" onClick={onClose}>
            {t.chats.dialog.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={entry === undefined || busy} aria-busy={busy ? true : undefined}>
            {t.chats.dialog.start}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

/** The account's five-hour and weekly windows as thin bars; the window's name and its reset in the tip. */
function Bars({ entry, now }: { entry: AccountEntry; now: Date }) {
  // `limitSpans` lists a window not read yet too: only the read ones get a bar.
  const windows = limitSpans(entry.limits).flatMap((span) => {
    const window = span === 'month' ? undefined : entry.limits?.[span]
    return window == null ? [] : [{ span, window }]
  })
  if (windows.length === 0) return null
  return (
    <span className="new-chat__bars">
      {windows.map(({ span, window }) => {
        const used = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
        return (
          <Tipped key={span} inline tip={`${spanNames(span).title}: ${used}% · ${formatSpan(window.resetsAt, now)}`}>
            <span className="new-chat__bar">
              <span className="new-chat__meter" aria-hidden="true">
                <span className={used >= 100 ? 'new-chat__fill new-chat__fill--full' : 'new-chat__fill'} style={{ width: `${used}%` }} />
              </span>
              {used}%
            </span>
          </Tipped>
        )
      })}
    </span>
  )
}
