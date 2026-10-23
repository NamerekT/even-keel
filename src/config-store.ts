import { randomUUID } from 'node:crypto'
import type { ChainRules } from './chain/rules.js'
import { formsOf, trackerChoices, withChainSwitches, withFeed, withNewProject, withoutFeed, withoutProject, withProjectForm, withRunAccount, withSharedAccount, withSharedForm, withTally, withUpdates } from './config-form.js'
import { parseConfig, trackerKeysOf, type EvenKeelConfig } from './config.js'
import { englishOf, fail, noticeOf, type Notice } from './notice/notice.js'
import { fileOf, fileRows, type FileContents } from './settings/file.js'
import { readSettings, saveSettings, settingsText } from './settings/store.js'
import type { Queryable, Writes } from './storage/database.js'
import type { ConfigView, FeedDraft, ProjectDraft, ProjectForm, SharedForm } from './state.js'
import type { TallyMode } from './stats/mode.js'
import { ADAPTERS } from './tracker/adapters.js'
import type { UpdateSettings } from './updates/release.js'

export interface ConfigStoreOptions {
  db: Queryable
  writes: Writes
  intervalMs: number
  /** `before` — the config the service ran on until now; the same as `current` when the stored one did not parse. */
  onChange: (before: EvenKeelConfig) => void
  warn: (message: string) => void
}

/**
 * The settings and project records of the state database (BTN-199), the one reader and writer the service has: the
 * forms' writers work on the config file's shape (`fileOf`), and a write puts its rows in place of the stored ones.
 * Rows are held in memory and written behind (`Writes`), so a save applies at once and stays synchronous.
 */
export class ConfigStore {
  /** What the service runs on: the last working config, applied as a whole on the fly. */
  current: EvenKeelConfig
  error: Notice | null = null
  private contents: FileContents
  /** `settingsText` of the database as this process knows it; its own writes count from the call. */
  private stored: string
  /** This process's writes so far: a look that began before one of them read what it replaces. */
  private written = 0
  private looking = false
  private timer: NodeJS.Timeout | undefined

  private constructor(
    private readonly options: ConfigStoreOptions,
    contents: FileContents,
  ) {
    this.current = parseConfig(fileOf(contents))
    this.contents = contents
    this.stored = settingsText(contents)
  }

  /** The stored settings; ones that do not parse throw. */
  static async open(options: ConfigStoreOptions): Promise<ConfigStore> {
    return new ConfigStore(options, await readSettings(options.db))
  }

  /** Looks at the database every `intervalMs`: a change written past this process (`config-import`) applies at once. */
  watch(): void {
    this.timer = setInterval(() => void this.look(), this.options.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  async look(): Promise<void> {
    if (this.looking) return
    this.looking = true
    const written = this.written
    try {
      const contents = await readSettings(this.options.db)
      const text = settingsText(contents)
      if (written !== this.written || text === this.stored) return
      this.stored = text
      this.apply(contents)
    } catch (error) {
      this.options.warn(`config: the settings were not read from the database: ${(error as Error).message}`)
    } finally {
      this.looking = false
    }
  }

  private apply(contents: FileContents): void {
    let next: EvenKeelConfig
    try {
      next = parseConfig(fileOf(contents))
    } catch (error) {
      this.error = noticeOf(error)
      this.options.warn(`config: the settings in the database are not applied, the last working config stays: ${englishOf(this.error)}`)
      this.options.onChange(this.current)
      return
    }
    this.contents = contents
    this.changed(next)
  }

  /** The settings in the shape of the config file: what the writers and the wizard's check take. */
  raw(): Record<string, unknown> {
    return fileOf(this.contents)
  }

  view(trackerLocked: string[] = []): ConfigView {
    return { ...formsOf(this.current), trackers: trackerChoices(), feeds: this.current.feeds, trackerLocked }
  }

  /** Adds the feed to the project with a new id, by the same rule as `saveProject`; returns the id. */
  addFeed(project: string, draft: Omit<FeedDraft, 'profile'>): string {
    const id = randomUUID()
    this.write(withFeed(this.raw(), this.idOf(project), { id, ...draft }))
    return id
  }

  /** Drops the project's feed, by the same rule as `saveProject`. */
  removeFeed(project: string, feed: string): void {
    this.write(withoutFeed(this.raw(), this.idOf(project), feed))
  }

  /** Writes the project's settings, only if the whole config still parses, and applies them at once; `profile` as in `withProjectForm`. */
  saveProject(project: string, form: ProjectForm, base: ProjectForm, profile: Partial<ChainRules> = {}): void {
    this.write(withProjectForm(this.raw(), this.idOf(project), form, base, profile))
  }

  /** Writes the shared settings, by the same rule as `saveProject`. */
  saveShared(form: SharedForm, base: SharedForm): void {
    this.write(withSharedForm(this.raw(), form, base))
  }

  /** Writes the shared provider and its account the Even Keel role moved to, by the same rule as `saveProject`. */
  saveActive(provider: string, key: string): void {
    this.write(withRunAccount(this.raw(), provider, key))
  }

  /** Writes the shared pool's account of the provider alone, by the same rule as `saveProject`. */
  saveSharedAccount(provider: string, key: string): void {
    this.write(withSharedAccount(this.raw(), provider, key))
  }

  /** Writes the given switches of `updates`, by the same rule as `saveProject`. */
  saveUpdates(patch: Partial<Pick<UpdateSettings, 'check' | 'notify'>>): void {
    this.write(withUpdates(this.raw(), patch))
  }

  /** Writes the chain's switches that differ from the current ones, by the same rule as `saveProject`. */
  saveChainSwitches(patch: Partial<Pick<EvenKeelConfig, 'unattended' | 'trimTools'>>): void {
    const changed = Object.entries(patch).filter(([key, on]) => this.current[key as keyof typeof patch] !== on)
    if (changed.length > 0) this.write(withChainSwitches(this.raw(), Object.fromEntries(changed)))
  }

  saveTally(mode: TallyMode): void {
    if (this.current.tally !== mode) this.write(withTally(this.raw(), mode))
  }

  /** Adds the wizard's project last, with a new id, by the same rule as `saveProject`; returns the id. */
  addProject(draft: ProjectDraft): string {
    const id = randomUUID()
    this.write(withNewProject(this.raw(), draft, id))
    return id
  }

  /** Drops the project and its rows, by the same rule as `saveProject`; whether anything still holds it is the caller's to ask. */
  removeProject(project: string): void {
    this.write(withoutProject(this.raw(), this.idOf(project)))
  }

  private idOf(project: string): string {
    if (this.current.projects[project] === undefined) throw fail('config.unknownProject', { key: project })
    return project
  }

  private write(next: Record<string, unknown>): void {
    const config = parseConfig(next)
    const contents = fileRows(next, trackerKeysOf(ADAPTERS))
    this.written++
    this.stored = settingsText(contents)
    this.options.writes.add('the settings', saveSettings(this.options.db, contents, 'page'))
    this.contents = contents
    this.changed(config)
  }

  private changed(next: EvenKeelConfig): void {
    const before = this.current
    this.current = next
    this.error = null
    this.options.onChange(before)
  }
}
