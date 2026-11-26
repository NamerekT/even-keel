import { useEffect, useMemo, useState } from 'react'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import type { MenuEntry } from '../../../src/sessions/commands.js'
import { language } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { evenKeelItems, menuItems, type MenuItem } from './chatCommands.js'

/** What the field's `/` menu offers; `refresh` reads the session's part again, as the menu opens. */
export interface ChatMenu {
  items: readonly MenuItem[]
  refresh: () => void
}

/** A menu of Even Keel's commands alone, for a field that sends nothing. */
export function evenKeelMenu(): ChatMenu {
  return { items: evenKeelItems(language), refresh: () => {} }
}

/**
 * The `/` menu of a chat (BTN-1695): Even Keel's commands for a task's session (`task` set), and for a Claude or Codex
 * session the entries it calls itself, as the hub reads them for its agent (`chat/menu`): Claude's user commands and
 * skills and the package skills as `/name`, Codex's skills as `$name` (BTN-1737). Other agents get only Even Keel's;
 * `null` — a chat with nothing to offer. `chat` — a project chat's id: the hub reads the packages of the chat's own
 * choice (BTN-1716).
 */
export function useChatMenu(project: string, task: string | null, agent: string | undefined, chat: string | null = null): ChatMenu | null {
  const { read } = useLive()
  const reads = agent === CLAUDE || agent === CODEX ? agent : null
  const key = `${project}\u0000${task ?? ''}\u0000${chat ?? ''}\u0000${reads ?? ''}`
  const [entries, setEntries] = useState<{ key: string; list: readonly MenuEntry[] }>({ key, list: [] })
  const refresh = () => {
    if (reads === null) return
    read<MenuEntry[]>('chat/menu', { project, task, chat, agent: reads }).then(
      (list) => setEntries({ key, list }),
      () => {},
    )
  }
  useEffect(refresh, [key])
  const list = entries.key === key ? entries.list : []
  const sigil = reads === CODEX ? '$' : '/'
  const items = useMemo(() => menuItems(language, task !== null, list, sigil), [task, list, sigil])
  if (task === null && reads === null) return null
  return { items, refresh }
}
