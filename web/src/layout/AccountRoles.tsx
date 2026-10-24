import type { ReactNode } from 'react'
import { APP_LABELS, appSwitchProblem, type AppAccount, type AppId } from '../../../src/account/apps.js'
import { switchProblem, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { ChevronIcon, EditorIcon, EvenKeelIcon } from '../ui/icons.js'
import { place } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { usePopoverMenu } from '../ui/usePopoverMenu.js'
import { accountName, agentLabel } from '../accountName.js'
import type { Send } from './accountParts.js'
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
  /** The drawer's way: the chips without a frame, nothing for an account without roles, and the list behind a "Here" button. */
  compact?: boolean
}

/**
 * Where an account works, as one button: on the card the apps on it by name ("Used by: Even Keel, VS Code"), in the
 * drawer as icon chips. Its list offers the apps that are elsewhere, and picking one moves it here, off the account it
 * was on; an app that cannot move says why in its line.
 */
export function AccountRoles({ entry, view, sending, send, compact = false }: RolesProps) {
  const { open, setOpen, root, button, menu, onKeyDown } = usePopoverMenu<HTMLUListElement>(place)
  const roles = rolesOf(entry, view, send)
  const held = roles.filter((role) => role.held)
  const offers = roles.filter((role) => !role.held)

  if (roles.length === 0) return null
  const heldText = held.length === 0 ? t.account.rolesNone : held.map((role) => role.label).join(', ')
  const chips = compact ? (
    held.map((role) => (
      <Tipped key={role.label} className="roles__chip" tip={t.account.holds(role.label)} align="start" inline off={open} focusable>
        <role.icon />
      </Tipped>
    ))
  ) : (
    <span className={held.length === 0 ? 'roles__text roles__text--none' : 'roles__text'}>
      {held.length === 0 ? t.account.rolesNone : t.account.usedBy(heldText)}
    </span>
  )
  if (offers.length === 0) {
    if (compact) return held.length === 0 ? null : <div className="roles roles--bare">{chips}</div>
    return <div className="roles roles--fixed">{chips}</div>
  }

  return (
    <div className={compact ? 'roles roles--bare' : 'roles'} ref={root}>
      {compact && chips}
      <button
        ref={button}
        type="button"
        className={compact ? 'roles__move' : 'roles__field'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? t.account.moveHereFull : `${t.account.roles}. ${heldText}`}
        disabled={sending}
        onClick={() => setOpen(!open)}
      >
        {compact ? t.account.moveHere : chips}
        <ChevronIcon />
      </button>
      <ul ref={menu} popover="manual" role="menu" className="roles__menu" onKeyDown={onKeyDown}>
        {/* The drawer shows the held roles as icons only; on a touch screen, with no pointing, this is where they are named. */}
        {open &&
          compact &&
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
          ? t.account.chainsStay(accountName(active, view.accounts))
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
