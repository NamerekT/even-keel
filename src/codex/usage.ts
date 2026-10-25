import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import { chatGptAccountIn, chatGptPool, chatGptSignInIn, pollChatGpt, type ChatGptSignIn } from '../limits/chatgpt.js'
import type { UsageAnswer } from '../limits/usage.js'
import { notice } from '../notice/notice.js'
import { isLive, type AgentEntry } from '../sessions/agents.js'
import { limitsOfRollout, rolloutFiles } from './rollout.js'

/** How many of the newest rollouts are searched for the account's limits. */
const LIMIT_ROLLOUTS = 20

interface UsageOptions {
  timeoutMs: number
  sessions(home: AccountHome): Promise<AgentEntry[]>
  refresh(home: AccountHome): Promise<unknown>
}

/** ChatGPT polling with one Codex-owned renewal per refusal, then the account's rollouts as a fallback. */
export class CodexUsage {
  private readonly refused = new Map<string, Set<string>>()
  private readonly reading = new Map<string, Promise<UsageAnswer>>()
  private readonly starting = new Map<string, number>()

  constructor(private readonly options: UsageOptions) {}

  /** A launch and a resume wait for renewal; a poll does not renew while either is starting a turn. */
  async session<T>(home: AccountHome, start: () => Promise<T>): Promise<T> {
    this.starting.set(home.dir, (this.starting.get(home.dir) ?? 0) + 1)
    try {
      await this.reading.get(home.dir)?.catch(() => undefined)
      return await start()
    } finally {
      const left = this.starting.get(home.dir)! - 1
      if (left === 0) this.starting.delete(home.dir)
      else this.starting.set(home.dir, left)
    }
  }

  read(home: AccountHome, at: string): Promise<UsageAnswer> {
    const held = this.reading.get(home.dir)
    if (held !== undefined) return held
    const pending = this.readUsage(home, at).finally(() => this.reading.delete(home.dir))
    this.reading.set(home.dir, pending)
    return pending
  }

  private async readUsage(home: AccountHome, at: string): Promise<UsageAnswer> {
    let auth = await readAuth(home)
    const signIn = chatGptSignInIn(auth)
    let answer: UsageAnswer | undefined
    if (signIn !== undefined) {
      answer = await pollChatGpt(signIn, at, this.options.timeoutMs).catch(() => undefined)
      if (answer?.kind === 'missing' && answer.reason.code === 'usage.chatGptRevoked') {
        if (!this.refused.get(home.dir)?.has(signIn.token)) answer = await this.refresh(home, signIn, at, answer).catch(() => answer)
        auth = await readAuth(home)
      }
      if (answer?.kind === 'limits') {
        this.refused.delete(home.dir)
        return answer
      }
    }
    const account = chatGptAccountIn(auth)
    for (const { file } of (await rolloutFiles(home.dir)).slice(0, LIMIT_ROLLOUTS)) {
      const limits = limitsOfRollout(await readFile(file, 'utf8').catch(() => ''))
      if (limits !== undefined) return { kind: 'limits', limits: account === null ? limits : { ...limits, pool: chatGptPool(account) } }
    }
    return answer?.kind === 'missing' ? answer : { kind: 'missing', reason: notice('usage.noRollout', {}) }
  }

  private async refresh(home: AccountHome, signIn: ChatGptSignIn, at: string, refused: UsageAnswer): Promise<UsageAnswer> {
    if (this.starting.has(home.dir) || (await this.options.sessions(home)).some(isLive) || this.starting.has(home.dir)) return refused
    // Remember both tokens even if the refresh or its retry fails: the next poll must not renew them again.
    const tokens = new Set([signIn.token])
    this.refused.set(home.dir, tokens)
    try {
      await this.options.refresh(home)
      const renewed = chatGptSignInIn(await readAuth(home))
      if (renewed === undefined) return refused
      tokens.add(renewed.token)
      if (renewed.token === signIn.token) return refused
      return await pollChatGpt(renewed, at, this.options.timeoutMs)
    } catch {
      return refused
    }
  }
}

function readAuth(home: AccountHome): Promise<string | undefined> {
  return readFile(join(home.dir, 'auth.json'), 'utf8').catch(() => undefined)
}
