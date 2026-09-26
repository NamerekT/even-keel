import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { cleanOutput, loginUrls, type AccountLogin, type AccountView, type ClaudeAccount } from './model.js'

const MAX_OUTPUT_CHARS = 16 * 1024
const SHOWN_OUTPUT_CHARS = 2 * 1024

export interface AccountWatcherOptions {
  status: () => Promise<ClaudeAccount>
  login: () => ChildProcessWithoutNullStreams
  loginBlock: () => string | undefined
  intervalMs: number
  loginTimeoutMs: number
  now: () => Date
  onChange: () => void
  onError: (error: unknown) => void
}

export class AccountWatcher {
  private status: ClaudeAccount | null = null
  private error: string | null = null
  private current: AccountLogin | null = null
  private child: ChildProcessWithoutNullStreams | undefined
  private output = ''
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly options: AccountWatcherOptions) {}

  get view(): AccountView {
    return { status: this.status, error: this.error, login: this.current, loginBlock: this.options.loginBlock() ?? null }
  }

  start(): void {
    if (this.timer !== undefined) return
    const tick = () => {
      void this.refresh().finally(() => {
        this.timer = setTimeout(tick, this.options.intervalMs)
      })
    }
    tick()
  }

  async refresh(): Promise<void> {
    let status = this.status
    let error: string | null = null
    try {
      status = await this.options.status()
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
      if (error !== this.error) this.options.onError(reason)
    }
    if (JSON.stringify([status, error]) === JSON.stringify([this.status, this.error])) return
    this.status = status
    this.error = error
    this.options.onChange()
  }

  login(): void {
    if (this.child !== undefined) throw new Error('claude: a sign-in is already running')
    const blocked = this.options.loginBlock()
    if (blocked !== undefined) throw new Error(blocked)

    const child = this.options.login()
    this.child = child
    this.output = ''
    this.current = { startedAt: this.options.now().toISOString(), urls: [], output: '', error: null, codeSent: false }
    const timeout = setTimeout(() => {
      this.fail(child, `claude: sign-in did not finish in ${Math.round(this.options.loginTimeoutMs / 60_000)} min`)
      child.kill()
    }, this.options.loginTimeoutMs)

    const read = (chunk: Buffer) => {
      if (this.child !== child || this.current === null) return
      this.output = (this.output + chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS)
      const urls = [...new Set([...this.current.urls, ...loginUrls(this.output)])]
      this.current = { ...this.current, urls, output: cleanOutput(this.output).trim().slice(-SHOWN_OUTPUT_CHARS) }
      this.options.onChange()
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (error) => {
      clearTimeout(timeout)
      this.fail(child, `claude: could not start the sign-in: ${error.message}`)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0 && this.child === child) {
        this.child = undefined
        this.current = null
        this.options.onChange()
        void this.refresh()
        return
      }
      const lastLine = cleanOutput(this.output).trim().split('\n').at(-1) ?? ''
      this.fail(child, `claude: sign-in exited with code ${code}${lastLine === '' ? '' : `: ${lastLine}`}`)
    })
    this.options.onChange()
  }

  code(code: string): void {
    if (this.child === undefined || this.current === null) throw new Error('claude: no sign-in is running')
    this.child.stdin.write(`${code}\n`)
    this.current = { ...this.current, codeSent: true }
    this.options.onChange()
  }

  cancel(): void {
    const child = this.child
    this.child = undefined
    this.current = null
    child?.kill()
    this.options.onChange()
  }

  private fail(child: ChildProcessWithoutNullStreams, error: string): void {
    if (this.child !== child || this.current === null) return
    this.child = undefined
    this.current = { ...this.current, error }
    this.options.onChange()
  }
}
