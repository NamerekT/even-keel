import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SessionRecord } from '../sessions/agents.js'
import { configDirOf, vscodeChats, withConfigDir, type AppAccount } from './apps.js'
import type { AccountHome } from './homes.js'

const NO_FILE = 'vscode: the VS Code settings file is only looked for on Windows'

export interface VsCodeAccountOptions {
  file: string | null
  homes: () => AccountHome[]
  ownerOf: (dir: string | null) => string | undefined
  records: (home: AccountHome) => Promise<SessionRecord[]>
  intervalMs: number
  onChange: () => void
  onError: (error: unknown) => void
}

export function vscodeSettingsFile(env: NodeJS.ProcessEnv): string | null {
  if (process.platform !== 'win32') return null
  return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Code', 'User', 'settings.json')
}

export class VsCodeAccount {
  private current: AppAccount = { app: 'vscode', account: null, dir: null, error: null, sessions: [] }
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly options: VsCodeAccountOptions) {}

  get view(): AppAccount {
    return this.current
  }

  start(): void {
    if (this.timer !== undefined) return
    const tick = () => {
      void this.refresh()
        .catch(this.options.onError)
        .finally(() => {
          this.timer = setTimeout(tick, this.options.intervalMs)
        })
    }
    tick()
  }

  async refresh(): Promise<void> {
    const next = await this.read()
    if (JSON.stringify(next) === JSON.stringify(this.current)) return
    this.current = next
    this.options.onChange()
  }

  point(home: AccountHome): void {
    const file = this.options.file
    if (file === null) throw new Error(NO_FILE)
    const next = withConfigDir(readText(file), home.global ? null : home.dir)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, next)
  }

  private async read(): Promise<AppAccount> {
    const records = await Promise.all(this.options.homes().map((home) => this.options.records(home)))
    const sessions = vscodeChats(records.flat())
    const blank = { app: 'vscode' as const, account: null, dir: null, sessions }
    if (this.options.file === null) return { ...blank, error: NO_FILE }
    try {
      const dir = configDirOf(readText(this.options.file))
      return { ...blank, account: this.options.ownerOf(dir) ?? null, dir, error: null }
    } catch (error) {
      return { ...blank, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8').replace(/^﻿/, '')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
