import { watchFile } from 'node:fs'
import { liveConfig, loadConfig, restartChanges, type EvenKeelConfig } from './config.js'

export interface ConfigFileOptions {
  file: string
  intervalMs: number
  onChange: () => void
  warn: (message: string) => void
}

export class ConfigFile {
  current: EvenKeelConfig
  error: string | null = null

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
      this.error = error instanceof Error ? error.message : String(error)
      this.options.warn(`config: ${this.options.file} is not applied, the last working config stays: ${this.error}`)
      this.options.onChange()
      return
    }
    const waiting = restartChanges(this.current, next)
    if (waiting.length > 0) this.options.warn(`config: ${waiting.join(', ')} changed and wait for a restart of Even Keel`)
    this.current = liveConfig(this.current, next)
    this.error = null
    this.options.onChange()
  }
}
