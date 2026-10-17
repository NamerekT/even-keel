import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { fail, notice, noticeOf } from '../notice/notice.js'
import { pathsOf } from '../paths.js'
import type { SessionRecord } from '../sessions/agents.js'
import { configDirOf, isVsCodeChat, vscodeChats, withConfigDir, type AppAccount, type AppSession } from './apps.js'
import type { AccountHome } from './homes.js'

export interface VsCodeAccountOptions {
  file: string | null
  homes: () => AccountHome[]
  ownerOf: (dir: string | null) => string | undefined
  records: (home: AccountHome) => Promise<SessionRecord[]>
  /** The chat's tab title from its transcript, null until it has one. */
  title: (home: AccountHome, sessionId: string) => Promise<string | null>
  intervalMs: number
  onChange: () => void
  onError: (error: unknown) => void
}

export function vscodeSettingsFile(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, home = homedir()): string | null {
  const { join } = pathsOf(platform)
  const user = ['Code', 'User', 'settings.json']
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), ...user)
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', ...user)
  if (platform === 'linux') return join(env.XDG_CONFIG_HOME || join(home, '.config'), ...user)
  return null
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
    if (file === null) throw fail('vscode.noFile', {})
    const next = withConfigDir(readText(file), home.global ? null : home.dir)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, next)
  }

  private async read(): Promise<AppAccount> {
    const chats = await Promise.all(this.options.homes().map((home) => this.chatsOf(home)))
    const sessions = chats.flat()
    const blank = { app: 'vscode' as const, account: null, dir: null, sessions }
    if (this.options.file === null) return { ...blank, error: notice('vscode.noFile', {}) }
    try {
      const dir = configDirOf(readText(this.options.file))
      return { ...blank, account: this.options.ownerOf(dir) ?? null, dir, error: null }
    } catch (error) {
      return { ...blank, error: noticeOf(error) }
    }
  }

  private async chatsOf(home: AccountHome): Promise<AppSession[]> {
    const records = (await this.options.records(home)).filter(isVsCodeChat)
    const titled = await Promise.all(records.map(async (record) => ({ record, title: await this.options.title(home, record.sessionId) })))
    return vscodeChats(home.key, titled)
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
