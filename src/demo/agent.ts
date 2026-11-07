import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import type { AgentOptions, SessionStart } from '../agent/contract.js'
import { ScriptedAgent, type ScriptedSession, type Turn } from '../agent/scripted.js'
import type { Language } from '../language.js'
import type { FeedLine, TranscriptSummary } from '../sessions/transcript.js'
import { databaseDirOf } from '../storage/owner.js'
import { demoTurn, roleOf, type DemoRole } from './scenario.js'

/** The context window the demo's sessions show their fill against. */
const DEMO_WINDOW = 200_000

/** Where the demo lives in the state folder: its repository and its account folder (BTN-776). */
export function demoDirOf(stateDir: string): string {
  return join(databaseDirOf(stateDir), 'demo')
}

export const demoRepoOf = (dir: string) => join(dir, 'repo')
export const demoAccountOf = (dir: string) => join(dir, 'account')
const sessionsFileOf = (dir: string) => join(demoAccountOf(dir), 'sessions.json')

interface Saved {
  sessions: (Omit<ScriptedSession, 'turn' | 'wroteAt' | 'mcp'> & { role: DemoRole })[]
}

/**
 * The demo's agent: a script plays each task by its role (`src/demo/scenario.ts`). Its sessions are kept in its account
 * folder the way a CLI keeps its transcripts, so a restart of the service finds them; one found mid-turn plays that
 * turn again. It needs no sign-in and has no limits.
 */
export class DemoAgent extends ScriptedAgent {
  private dir: string | null = null
  private language: () => Language = () => 'en'
  private readonly roles = new Map<string, DemoRole>()

  constructor() {
    super((cwd) => repoOfCwd(cwd), undefined, 'Demo')
  }

  protected override setUp(options: AgentOptions): void {
    super.setUp(options)
    this.dir = demoDirOf(options.workDir)
    if (options.language !== undefined) this.language = options.language
    this.load()
  }

  override async launch(home: AccountHome, start: SessionStart): Promise<string> {
    // The first turn starts inside `super.launch` and finds its role by the prompt the session keeps.
    const sessionId = await super.launch(home, start)
    this.roles.set(sessionId, roleOf(start.prompt))
    const session = this.known.get(sessionId)!
    session.summary = { ...session.summary, contextWindow: DEMO_WINDOW, model: 'demo' }
    this.changed()
    return sessionId
  }

  override async feed(_home: AccountHome, sessionId: string, after: number): Promise<{ lines: FeedLine[]; turn: TranscriptSummary['turn'] } | undefined> {
    const session = this.known.get(sessionId)
    return session === undefined ? undefined : { lines: session.lines.slice(after), turn: session.summary.turn }
  }

  override async authStatus(): Promise<AccountStatus> {
    return { loggedIn: true, authMethod: 'demo', email: null, orgName: null, subscriptionType: null }
  }

  /** Drops every session and the file that keeps them: the demo is removed or begins anew. */
  forget(): void {
    // A turn under way finds itself let go at its next pause (`TurnContext.live`).
    this.known.clear()
    this.roles.clear()
    if (this.dir !== null) rmSync(sessionsFileOf(this.dir), { force: true })
  }

  protected override nextTurn(session: ScriptedSession): Turn {
    const role = this.roles.get(session.entry.sessionId) ?? roleOf(session.prompt)
    return demoTurn(role, session.plays, this.language)
  }

  protected override changed(): void {
    if (this.dir === null || !existsSync(demoAccountOf(this.dir))) return
    const sessions = [...this.known.values()].map(({ entry, summary, lines, plays, prompt }) => ({ entry, summary, lines, plays, prompt, role: this.roles.get(entry.sessionId) ?? 'added' }))
    const file = sessionsFileOf(this.dir)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ sessions } satisfies Saved))
  }

  private load(): void {
    if (this.dir === null || !existsSync(sessionsFileOf(this.dir))) return
    let saved: Saved
    try {
      saved = JSON.parse(readFileSync(sessionsFileOf(this.dir), 'utf8')) as Saved
    } catch {
      return
    }
    for (const { role, ...session } of saved.sessions) {
      this.known.set(session.entry.sessionId, { ...session, turn: 0, wroteAt: Date.now(), mcp: [] })
      this.roles.set(session.entry.sessionId, role)
    }
    for (const session of saved.sessions) if (session.entry.status === 'busy') this.replay(session.entry.sessionId)
  }
}

/** The demo repository a session's folder is in: its worktrees are under its `.claude/worktrees/`. */
function repoOfCwd(cwd: string): string {
  const at = cwd.replaceAll('\\', '/').lastIndexOf('/.claude/worktrees/')
  return at === -1 ? cwd : cwd.slice(0, at)
}

/** The one demo agent of the service, registered in `AGENTS`. */
export const demoAgent = new DemoAgent()
