import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { APP_LABELS, appSwitchProblem, type AppAccount, type AppId } from '../../../src/account/apps.js'
import { switchProblem, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { ChevronIcon, EditorIcon, EvenKeelIcon } from '../ui/icons.js'
import { place } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { accountName, agentLabel, type Send } from './accountParts.js'
import './roles.css'

const APP_ICONS: Record<AppId, () => ReactNode> = { vscode: EditorIcon }

interface Role {
  label: string
  /** What stands for the role in the field, so two roles take no more room than one; the label is in its tip and the menu. */
  icon: () => ReactNode
  held: boolean
  problem: Notice | undefined
  /** What moving it here does; shown while it can move. */
  note: string
  pick: () => Promise<boolean>
}

interface RolesProps {
  entry: AccountEntry
  view: AccountView
  sending: boolean
  send: Send
}

/**
 * Where an account works, as one button: the apps on it as chips. Its list offers the apps that are elsewhere, and
 * picking one moves it here, off the account it was on; an app that cannot move says why in its line.
 */
export function AccountRoles({ entry, view, sending, send }: RolesProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const roles = rolesOf(entry, view, send)
  const held = roles.filter((role) => role.held)
  const offers = roles.filter((role) => !role.held)

  useLayoutEffect(() => {
    const element = menu.current
    const owner = button.current
    if (!open || element === null || owner === null) return
    element.showPopover()
    place(element, owner.getBoundingClientRect())
    element.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])')?.focus()
    const away = (event: Event) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', shut)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [open])

  if (roles.length === 0) return null
  const chips =
    held.length === 0 ? (
      <span className="roles__none">{t.account.rolesNone}</span>
    ) : (
      held.map((role) => (
        <Tipped key={role.label} className="roles__chip" tip={t.account.holds(role.label)} align="start" inline off={open} focusable={offers.length === 0}>
          <role.icon />
        </Tipped>
      ))
    )
  const heldText = held.length === 0 ? t.account.rolesNone : held.map((role) => role.label).join(', ')
  if (offers.length === 0) return <div className="roles roles--fixed">{chips}</div>

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      // The drawer around would take the same Escape as its own close.
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const at = items.findIndex((item) => item === document.activeElement)
      const next = at + (event.key === 'ArrowDown' ? 1 : -1)
      items[(next + items.length) % items.length]?.focus()
    }
  }

  return (
    <div className="roles" ref={root}>
      <button
        ref={button}
        type="button"
        className="roles__field"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.account.roles}. ${heldText}`}
        disabled={sending}
        onClick={() => setOpen(!open)}
      >
        {chips}
        <ChevronIcon />
      </button>
      <ul ref={menu} popover="manual" role="menu" className="roles__menu" onKeyDown={onKeyDown}>
        {/* The field shows the held roles as icons only; on a touch screen, with no pointing, this is where they are named. */}
        {open &&
          held.map((role) => (
            <li key={role.label} role="none" className="roles__here">
              <role.icon />
              {t.account.holds(role.label)}
            </li>
          ))}
        {open &&
          offers.map((role) => (
            <li key={role.label} role="none">
              <button
                type="button"
                role="menuitem"
                className="roles__offer"
                // Not `disabled`: a disabled button takes no hover, and its line says why it cannot move.
                aria-disabled={role.problem !== undefined}
                onClick={() => {
                  if (role.problem !== undefined) return
                  setOpen(false)
                  void role.pick()
                }}
              >
                <span className="roles__label">
                  <role.icon />
                  {role.label}
                </span>
                {role.problem === undefined ? <span className="roles__note">{role.note}</span> : <span className="roles__why">{say(role.problem)}</span>}
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}

/** The Even Keel role on any account, moving the shared provider with it; the apps only on Claude's. */
function rolesOf(entry: AccountEntry, view: AccountView, send: Send): Role[] {
  const active = view.accounts.find((each) => each.key === view.active)
  const running = (view.loginBlock?.chains.length ?? 0) > 0
  const evenKeel: Role = {
    label: 'Even Keel',
    icon: EvenKeelIcon,
    held: view.active === entry.key,
    problem: view.active === entry.key ? undefined : switchProblem(view, entry.key),
    note:
      active !== undefined && active.agent !== entry.agent
        ? t.account.providerHere(agentLabel(entry.agent))
        : running && active !== undefined
          ? t.account.chainsStay(accountName(active))
          : t.account.nextHere,
    pick: () => send('account/switch', { account: entry.key }),
  }
  if (entry.agent !== CLAUDE) return [evenKeel]
  return [evenKeel, ...view.apps.map((app) => appRole(entry, view, app, send))]
}

function appRole(entry: AccountEntry, view: AccountView, app: AppAccount, send: Send): Role {
  const label = APP_LABELS[app.app]
  const held = app.account === entry.key
  const elsewhere = app.account === null && app.dir !== null ? `; ${t.account.appOn(t.account.unknownDir(app.dir))}` : ''
  return {
    label,
    icon: APP_ICONS[app.app],
    held,
    problem: held ? undefined : appSwitchProblem(view, app.app, entry.key),
    note: `${t.account.reload(label)}${elsewhere}`,
    pick: () => send('account/app', { app: app.app, account: entry.key }),
  }
}

/**
 * What runs on the account now, in one line of a fixed height: sessions coming and going would otherwise resize the card and its whole row.
 * The list — app chats by the titles of their tabs, the rest (chain and terminal sessions) by name — is in its tip.
 */
export function AccountWork({ entry, view }: { entry: AccountEntry; view: AccountView }) {
  const chats = view.apps.flatMap((app) => app.sessions.filter((chat) => chat.account === entry.key).map((chat) => ({ ...chat, app: APP_LABELS[app.app] })))
  const inChats = new Set(chats.map((chat) => chat.session))
  const others = entry.sessions.filter((name) => !inChats.has(name))
  const total = chats.length + others.length
  if (total === 0) return <div className="work work--none">{t.account.workNone}</div>
  const busy = chats.filter((chat) => chat.status === 'busy' || chat.status === 'shell').length
  const waiting = chats.filter((chat) => chat.status === 'waiting').length
  const list = (
    <div className="work__tip">
      <span className="work__label">{t.account.workingNow}</span>
      <ul className="work__list">
        {others.map((name, index) => (
          <li key={`session-${name}-${index}`} className="work__item">
            <span className="work__name">{name}</span>
          </li>
        ))}
        {chats.map((chat, index) => (
          <li key={`chat-${chat.session}-${index}`} className="work__item work__item--chat">
            <span className="work__name">{chat.name}</span>
            <span className="work__where">
              {chat.app} · {t.account.chats[chat.status ?? 'idle']}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <Tipped className="work" tip={list} align="start" focusable>
      <span className="work__count">{t.account.workSessions(total)}</span>
      {busy > 0 && <span className="work__busy">{t.account.workBusy(busy)}</span>}
      {waiting > 0 && <span className="work__waiting">{t.account.workWaiting(waiting)}</span>}
    </Tipped>
  )
}
