import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { APP_LABELS, appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import { switchProblem, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { ChevronIcon } from '../ui/icons.js'
import { place } from '../ui/Select.js'
import { accountName, type Send } from './accountParts.js'
import './roles.css'

interface Role {
  label: string
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
        <span key={role.label} className="roles__chip" title={t.account.holds(role.label)}>
          {role.label}
        </span>
      ))
    )
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
        title={t.account.roles}
        disabled={sending}
        onClick={() => setOpen(!open)}
      >
        {chips}
        <ChevronIcon />
      </button>
      <ul ref={menu} popover="manual" role="menu" className="roles__menu" onKeyDown={onKeyDown}>
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
                <span className="roles__label">{role.label}</span>
                {role.problem === undefined ? <span className="roles__note">{role.note}</span> : <span className="roles__why">{say(role.problem)}</span>}
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}

function rolesOf(entry: AccountEntry, view: AccountView, send: Send): Role[] {
  if (entry.agent !== CLAUDE) return []
  const active = view.accounts.find((each) => each.key === view.active)
  const running = (view.loginBlock?.chains.length ?? 0) > 0
  const evenKeel: Role = {
    label: 'Even Keel',
    held: view.active === entry.key,
    problem: view.active === entry.key ? undefined : switchProblem(view, entry.key),
    note: running && active !== undefined ? t.account.chainsStay(accountName(active)) : t.account.nextHere,
    pick: () => send('account/switch', { account: entry.key }),
  }
  return [evenKeel, ...view.apps.map((app) => appRole(entry, view, app, send))]
}

function appRole(entry: AccountEntry, view: AccountView, app: AppAccount, send: Send): Role {
  const label = APP_LABELS[app.app]
  const held = app.account === entry.key
  const elsewhere = app.account === null && app.dir !== null ? `; ${t.account.appOn(t.account.unknownDir(app.dir))}` : ''
  return {
    label,
    held,
    problem: held ? undefined : appSwitchProblem(view, app.app, entry.key),
    note: `${t.account.reload(label)}${elsewhere}`,
    pick: () => send('account/app', { app: app.app, account: entry.key }),
  }
}

/** What runs on the account now: app chats by the titles of their tabs, the rest — chain and terminal sessions — by name. */
export function AccountWork({ entry, view }: { entry: AccountEntry; view: AccountView }) {
  const chats = view.apps.flatMap((app) => app.sessions.filter((chat) => chat.account === entry.key).map((chat) => ({ ...chat, app: APP_LABELS[app.app] })))
  const inChats = new Set(chats.map((chat) => chat.session))
  const others = entry.sessions.filter((name) => !inChats.has(name))
  if (chats.length === 0 && others.length === 0) return null
  return (
    <div className="work">
      <span className="work__label">{t.account.workingNow}</span>
      <ul className="work__list">
        {others.map((name, index) => (
          <li key={`session-${name}-${index}`} className="work__item">
            <span className="work__name">{name}</span>
          </li>
        ))}
        {chats.map((chat, index) => (
          <li key={`chat-${chat.session}-${index}`} className="work__item work__item--chat">
            <span className="work__name" title={chat.name}>
              {chat.name}
            </span>
            <span className="work__where">
              {chat.app} · {t.account.chats[chat.status ?? 'idle']}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
