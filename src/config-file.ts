import { watchFile, writeFileSync } from 'node:fs'
import { liveConfig, loadConfig, parseConfig, readRawConfig, restartChanges, withProjectSettings, type EvenKeelConfig } from './config.js'
import { englishOf, fail, noticeOf, type Notice } from './notice/notice.js'
import type { ProjectSettings } from './state.js'

export interface ConfigFileOptions {
  file: string
  intervalMs: number
  onChange: () => void
  warn: (message: string) => void
}

export class ConfigFile {
  current: EvenKeelConfig
  error: Notice | null = null

  constructor(private readonly options: ConfigFileOptions) {
    this.current = loadConfig(options.file)
  }

  watch(): void {
    watchFile(this.options.file, { interval: this.options.intervalMs, persistent: false }, (now, before) => {
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) this.reload()
    })
  }

  reload(): void {
    let next: EvenKeelConfig
    try {
      next = loadConfig(this.options.file)
    } catch (error) {
      this.error = noticeOf(error)
      this.options.warn(`config: ${this.options.file} is not applied, the last working config stays: ${englishOf(this.error)}`)
      this.options.onChange()
      return
    }
    const waiting = restartChanges(this.current, next)
    if (waiting.length > 0) this.options.warn(`config: ${waiting.join(', ')} changed and wait for a restart of Even Keel`)
    this.current = liveConfig(this.current, next)
    this.error = null
    this.options.onChange()
  }

  /** Writes the project's settings into the file, only if the whole config still parses, and applies them at once. */
  saveProject(project: string, settings: ProjectSettings): void {
    const { file } = this.options
    const raw = readRawConfig(file)
    const projects = (raw as { projects?: unknown } | null)?.projects
    if (typeof projects !== 'object' || projects === null || !Object.hasOwn(projects, project)) throw fail('config.unknownProject', { key: project })
    const next = { ...(raw as Record<string, unknown>), projects: { ...projects, [project]: withProjectSettings((projects as Record<string, unknown>)[project], settings) } }
    parseConfig(next)
    try {
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    } catch (error) {
      throw fail('config.writeFailed', { file }, { detail: (error as Error).message }, { cause: error })
    }
    this.reload()
  }
}
