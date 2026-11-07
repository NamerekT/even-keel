import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { BuiltinControl } from '../builtin/control.js'
import { BUILTIN } from '../builtin/model.js'
import type { BuiltinStore } from '../builtin/store.js'
import { DEFAULT_BRANCH, type EvenKeelConfig } from '../config.js'
import type { Git } from '../git/types.js'
import type { Language } from '../language.js'
import { fail } from '../notice/notice.js'
import { samePath } from '../paths.js'
import type { ProjectDraft } from '../state.js'
import { demoAgent as theAgent, demoAccountOf, demoDirOf, demoRepoOf, type DemoAgent } from './agent.js'
import { DEMO_ACCOUNT, DEMO_AGENT, DEMO_KEY, type DemoView } from './model.js'
import { demoReadme, demoTasks } from './scenario.js'

export interface DemoDeps {
  stateDir: string
  git: Git
  config: () => EvenKeelConfig
  language: () => Language
  /** Writes the project with its own settings; returns its id. */
  addProject: (draft: ProjectDraft, own: Record<string, unknown>) => string
  removeProject: (project: string) => void
  builtin: Pick<BuiltinControl, 'create' | 'relate'>
  store: () => Pick<BuiltinStore, 'list' | 'forget'>
  startChain: (project: string) => Promise<void>
  stopChain: (project: string) => void
  /** The chain runs the project or has it queued. */
  chainOn: (project: string) => boolean
  homes: { setDemo(home: AccountHome): void }
  /** Reads the account folders anew: the chain launches only on a folder the accounts' view lists. */
  refreshAccounts: () => Promise<void>
  /** Deletes the project's rows the chain kept: its launches, closed tasks and merge marks. */
  forgetRows: (project: string) => Promise<void>
  changed: () => void
  agent?: DemoAgent
}

/** The demo's tasks are at least these many: the demo is over once that many are closed and none is open. */
const DEMO_TASKS = 3

/**
 * The demo on the first run (BTN-776): a real repository in the state folder, a project on the built-in tracker and the
 * demo's agent, run by the real chain. The project is the demo's by its repository: no other state marks it.
 */
export class DemoService {
  readonly dir: string
  readonly repo: string
  private readonly agent: DemoAgent
  private finished = false
  private busy: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: DemoDeps) {
    this.dir = demoDirOf(deps.stateDir)
    this.repo = demoRepoOf(this.dir)
    this.agent = deps.agent ?? theAgent
    deps.homes.setDemo(this.home())
  }

  /** The demo project's id; `undefined` — there is no demo. */
  project(): string | undefined {
    const { projects } = this.deps.config()
    return Object.keys(projects).find((id) => samePath(projects[id]!, this.repo))
  }

  owns(project: string | undefined): boolean {
    return project !== undefined && project === this.project()
  }

  view(): DemoView | null {
    const project = this.project()
    return project === undefined ? null : { project, finished: this.finished }
  }

  /** Reads whether every task of the demo is closed; a change goes to the page. */
  async check(): Promise<void> {
    const project = this.project()
    let finished = false
    if (project !== undefined) {
      const tasks = await this.deps.store().list([project])
      const closed = tasks.filter((task) => task.status.category === 'Won' || task.status.category === 'Lost')
      finished = closed.length >= DEMO_TASKS && closed.length === tasks.length && !this.deps.chainOn(project)
    }
    if (finished === this.finished) return
    this.finished = finished
    this.deps.changed()
  }

  /** Makes the repository and the project and starts the chain; a demo already there is refused. */
  start(): Promise<string> {
    return this.serial(() => this.make())
  }

  /** The demo from scratch: the old one goes whole, a new one starts. */
  again(): Promise<string> {
    return this.serial(async () => {
      await this.drop()
      return this.make()
    })
  }

  /** Stops the demo's chain and sessions and deletes its folder, project and tasks. */
  remove(): Promise<void> {
    return this.serial(() => this.drop())
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.busy.then(run)
    this.busy = next.catch(() => undefined)
    return next
  }

  private async make(): Promise<string> {
    if (this.project() !== undefined) throw fail('demo.exists', {})
    const language = this.deps.language()
    await this.initRepo(language)
    mkdirSync(demoAccountOf(this.dir), { recursive: true })
    this.deps.homes.setDemo(this.home())
    await this.deps.refreshAccounts()
    const draft: ProjectDraft = {
      repo: this.repo,
      branch: DEFAULT_BRANCH,
      key: DEMO_KEY,
      name: language === 'ru' ? 'Демо' : 'Demo',
      tracker: BUILTIN,
      trackerProject: '',
      profile: null,
      slot: 0,
      milestones: [],
      provider: null,
    }
    const project = this.deps.addProject(draft, { testProject: true })
    const ids: string[] = []
    for (const task of demoTasks(language)) ids.push((await this.deps.builtin.create(project, { title: task.title, description: task.description, status: 'Todo' })).id)
    await this.deps.builtin.relate(ids[0]!, ids[1]!, 'blocks', true)
    this.finished = false
    await this.deps.startChain(project)
    console.log(`demo: the demo project ${project} is made and its chain started`)
    this.deps.changed()
    return project
  }

  private async drop(): Promise<void> {
    const project = this.project()
    if (project !== undefined) {
      if (this.deps.chainOn(project)) this.deps.stopChain(project)
      this.agent.forget()
      this.deps.removeProject(project)
      await this.deps.store().forget(project)
      await this.deps.forgetRows(project)
    } else this.agent.forget()
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    this.deps.homes.setDemo(this.home())
    await this.deps.refreshAccounts()
    this.finished = false
    console.log('demo: the demo is removed')
    this.deps.changed()
  }

  /** A fresh repository on the main branch with a README and one commit, its own name and e-mail to commit with. */
  private async initRepo(language: Language): Promise<void> {
    rmSync(this.repo, { recursive: true, force: true })
    mkdirSync(this.repo, { recursive: true })
    const git = async (...args: string[]) => {
      const result = await this.deps.git(this.repo, args)
      if (result.missing === true) throw fail('demo.noGit', {})
      if (result.code !== 0) throw fail('git.initFailed', { path: this.repo }, { detail: result.out })
      return result.out
    }
    await git('init', '-q', '-b', DEFAULT_BRANCH)
    for (const [key, value] of [['user.name', 'Even Keel demo'], ['user.email', 'demo@example.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await git('config', key!, value!)
    writeFileSync(join(this.repo, 'README.md'), demoReadme(language))
    writeFileSync(join(this.repo, '.gitignore'), '.claude/worktrees/\n.temp/\n')
    await git('add', '-A')
    await git('commit', '-q', '-m', 'Start the demo project')
  }

  /** Listed only while its folder exists (`AccountHomes.setDemo`): set again after a change, it is read anew. */
  private home(): AccountHome {
    return { key: DEMO_ACCOUNT, dir: demoAccountOf(this.dir), global: false, agent: DEMO_AGENT }
  }
}
