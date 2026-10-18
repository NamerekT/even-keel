import { watchFile } from 'node:fs'
import { formsOf, trackerChoices, withProjectForm, withRunAccount, withSharedForm, withUpdates } from './config-form.js'
import { ignoredKeys, parseConfig, readRawConfig, withIds, type EvenKeelConfig } from './config.js'
import { englishOf, fail, noticeOf, type Notice } from './notice/notice.js'
import { writeAtomic } from './storage/atomic.js'
import type { ConfigView, ProjectForm, SharedForm } from './state.js'
import type { UpdateSettings } from './updates/release.js'

export interface ConfigFileOptions {
  file: string
  intervalMs: number
  /** `before` — the config the service ran on until now; the same as `current` when the file did not parse. */
  onChange: (before: EvenKeelConfig) => void
  warn: (message: string) => void
}

export class ConfigFile {
  /** What the service runs on: the file's last working parse, applied as a whole on the fly. */
  current: EvenKeelConfig
  error: Notice | null = null

  constructor(private readonly options: ConfigFileOptions) {
    const raw = readRawConfig(options.file)
    this.current = this.parseFilled(raw)
    const ignored = ignoredKeys(raw)
    if (ignored.length > 0) {
      options.warn(`config: ${ignored.join(' and ')} in ${options.file} are not read; the address comes from EVEN_KEEL_HOST and EVEN_KEEL_PORT`)
    }
  }

  watch(): void {
    watchFile(this.options.file, { interval: this.options.intervalMs, persistent: false }, (now, before) => {
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) this.reload()
    })
  }

  reload(): void {
    let next: EvenKeelConfig
    try {
      next = this.parseFilled(readRawConfig(this.options.file))
    } catch (error) {
      this.error = noticeOf(error)
      this.options.warn(`config: ${this.options.file} is not applied, the last working config stays: ${englishOf(this.error)}`)
      this.options.onChange(this.current)
      return
    }
    const before = this.current
    this.current = next
    this.error = null
    this.options.onChange(before)
  }

  view(trackerLocked: string[] = []): ConfigView {
    return { ...formsOf(this.current), trackers: trackerChoices(), trackerLocked }
  }

  /** Writes the project's settings into its entry of the file, only if the whole config still parses, and applies what is live at once. */
  saveProject(project: string, form: ProjectForm, base: ProjectForm): void {
    const id = this.current.ids[project]
    if (id === undefined) throw fail('config.unknownProject', { key: project })
    this.write(withProjectForm(readRawConfig(this.options.file), id, form, base))
  }

  /** The config of the raw file; an entry added without an id gets one written into the file, once the whole file parses. */
  private parseFilled(raw: unknown): EvenKeelConfig {
    const { raw: filled, keys } = withIds(raw)
    const config = parseConfig(filled)
    if (keys.length === 0) return config
    const { file } = this.options
    try {
      writeAtomic(`${file}.bak`, `${JSON.stringify(raw, null, 2)}\n`)
      writeAtomic(file, `${JSON.stringify(filled, null, 2)}\n`)
    } catch (error) {
      throw fail('config.writeFailed', { file }, { detail: (error as Error).message }, { cause: error })
    }
    for (const key of keys) this.options.warn(`config: ${key} had no id, gave it ${config.ids[key]} in ${file}`)
    return config
  }

  /** Writes the shared settings into the file, by the same rule as `saveProject`. */
  saveShared(form: SharedForm, base: SharedForm): void {
    this.write(withSharedForm(readRawConfig(this.options.file), form, base))
  }

  /** Writes the shared provider and its account the Even Keel role moved to, by the same rule as `saveProject`. */
  saveActive(provider: string, key: string): void {
    this.write(withRunAccount(readRawConfig(this.options.file), provider, key))
  }

  /** Writes the given keys of `updates` into the file, by the same rule as `saveProject`. */
  saveUpdates(patch: Partial<UpdateSettings>): void {
    this.write(withUpdates(readRawConfig(this.options.file), patch))
  }

  private write(next: Record<string, unknown>): void {
    const { file } = this.options
    parseConfig(next)
    try {
      writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    } catch (error) {
      throw fail('config.writeFailed', { file }, { detail: (error as Error).message }, { cause: error })
    }
    this.reload()
  }
}
