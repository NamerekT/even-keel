import { hotkeyBindingsOf, type HotkeyBindings } from '../hotkeys.js'
import type { Queryable } from './database.js'

/**
 * The page's hotkeys of each browser that changed one (BTN-880), by the id it keeps in its `localStorage`; table
 * `browser_hotkeys` (step 38, `docs/storage.md`). A browser without a row keeps the defaults. A row that no longer
 * reads (an action gone) is left out.
 */
export async function loadBrowserHotkeys(db: Queryable): Promise<Record<string, HotkeyBindings>> {
  const { rows } = await db.query<{ browser: string; bindings: string }>('select browser, bindings from browser_hotkeys order by browser')
  const layouts: Record<string, HotkeyBindings> = {}
  for (const row of rows) {
    const bindings = hotkeyBindingsOf(JSON.parse(row.bindings))
    if (bindings !== null) layouts[row.browser] = bindings
  }
  return layouts
}

/** Starts its write at the call: see `Writes`. An empty layout is the defaults again: the row goes. */
export async function saveBrowserHotkeys(db: Queryable, browser: string, bindings: HotkeyBindings, at: Date): Promise<void> {
  if (Object.keys(bindings).length === 0) {
    await db.query('delete from browser_hotkeys where browser = $1', [browser])
    return
  }
  await db.query(
    `insert into browser_hotkeys (browser, bindings, saved_at) values ($1, $2, $3)
       on conflict (browser) do update set bindings = excluded.bindings, saved_at = excluded.saved_at`,
    [browser, JSON.stringify(bindings), at.toISOString()],
  )
}
