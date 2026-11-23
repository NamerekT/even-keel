import { notice } from '../../../src/notice/notice.js'
import { MACHINE_PALETTE, machineColors } from '../../../src/link/colors.js'
import { JOIN_KIND, type JoinRequest } from '../../../src/jobs/model.js'
import type { FolderProbe } from '../../../src/link/view.js'
import type { EvenKeelState, JobStep, MachineAbout, MachineCard, MachineInvite, MachinePage, MachineProject, MachineSignIn, MachineView, PoolMachine, ProjectPool, StepJob } from '../../../src/state.js'

/** A string issued in `dev:fake` is joined with this much later (BTN-1056). */
const JOIN_MS = 3_000
const INVITE_MS = 30 * 60_000

const about = (host: string, patch: Partial<MachineAbout> = {}): MachineAbout => ({
  host, os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: { claude: '2.1.322', codex: null, opencode: null, copilot: null }, gitUser: true,
  gitName: 'John Doe', gitEmail: 'john.doe@example.com', root: '/home/example/projects', ...patch,
})

/**
 * The machines elsewhere of `dev:fake` for the window that adds one (BTN-1056): with `?machines=…` the two of
 * `fakeMachineSignIns` are joined already (`?addMachine=machine-1` opens the laptop's step); a string issued joins
 * `JOIN_MS` later as a server named by its host when no name was given.
 */
export class FakeNetwork {
  private machines: MachineView[] = []
  private readonly listeners = new Set<() => void>()
  /** The pools of the projects (BTN-1271), by project: the own machine's row comes in on the first read. */
  private readonly pools = new Map<string, PoolMachine[]>()

  /** `repoOf` — a project's folder here, the own machine's row of its pool. */
  constructor(private readonly mode: string | null, private readonly repoOf: (project: string) => string = () => '') {
    this.held = mode === 'taken'
    if (mode === null) return
    const joined = (id: string, name: string, report: MachineAbout, online: boolean): MachineView => ({
      id, name, createdAt: Date.now() - 86_400_000, revokedAt: null, inviteExpires: null, joinedAt: Date.now() - 86_000_000, host: report.host, about: report, online, projects: [], taken: [],
    })
    // `follow`: the hub refused the laptop's API version and its update to the hub's commit failed (BTN-1275);
    // `container`: the laptop runs in a container, an older image the hub refused (BTN-1440).
    const laptop: Partial<MachineAbout> =
      mode === 'nocli' ? { agents: {} }
      : mode === 'version' ? { evenKeel: '0.3.9' }
      : mode === 'container' ? { evenKeel: '0.3.9', container: true, root: '/home/node/.local/share/even-keel/projects', follow: { to: '0.4.0', stuck: 'manual' } }
      : mode === 'follow' ? { commit: '4b1d2c3e5f60718293a4b5c6d7e8f90123456789', follow: { to: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432', stuck: 'failed' } }
      : { gitUser: false, gitName: undefined }
    this.machines = [
      joined('machine-1', 'Example laptop', about('example-laptop', laptop), mode !== 'offline' && mode !== 'follow' && mode !== 'container'),
      joined('machine-2', 'Example desktop', about('example-desktop', { os: 'win32 10.0.26200', agents: { claude: '2.1.322', codex: '0.98.0' }, root: 'D:/Projects' }), true),
    ]
    // The wizard's block (BTN-1297) shows each state of a row: a third machine, off the link.
    if (mode === 'signIn') this.machines.push(joined('machine-3', 'Example mini', about('example-mini', { os: 'darwin 24.1.0' }), false))
  }

  on(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The answer of a machines query; `undefined` — not one of them. */
  query(name: string, body: Record<string, unknown>): unknown {
    if (name === 'machines/list') return this.machines.map((machine) => ({ ...machine }))
    if (name === 'machines/pool') return this.poolOf(String(body.project))
    if (name === 'machines/folder') return folderProbe(String(body.folder), String(body.remote ?? body.project ?? ''))
    if (name !== 'machines/invite') return undefined
    const id = `machine-${this.machines.length + 1}`
    const given = String(body.name ?? '').trim()
    this.machines = this.machines.filter((machine) => machine.joinedAt !== null)
    this.machines.push({ id, name: given, createdAt: Date.now(), revokedAt: null, inviteExpires: Date.now() + INVITE_MS, joinedAt: null, host: null, about: null, online: false, projects: [], taken: [] })
    if (typeof body.color === 'string') this.colors.set(id, body.color)
    setTimeout(() => {
      const report = about('example-server', { agents: { claude: '2.1.322' } })
      this.machines = this.machines.map((machine) =>
        machine.id === id ? { ...machine, name: machine.name || report.host, joinedAt: Date.now(), inviteExpires: null, host: report.host, about: report, online: true } : machine,
      )
      for (const listener of this.listeners) listener()
    }, JOIN_MS)
    const line = `ek1_${btoa(id).replace(/=+$/, '')}example`
    return {
      line, machine: id, expiresAt: Date.now() + INVITE_MS, command: `npx even-keel@0.4.0 install --machine ${line}`,
      docker: { env: 'EVEN_KEEL_IMAGE_TAG=0.4.0', join: `docker compose run --rm machine even-keel join ${line}` },
    } satisfies MachineInvite
  }

  private rows(project: string): PoolMachine[] {
    const rows = this.pools.get(project) ?? [{ id: OWN, name: OWN_NAME, own: true, online: true, folder: this.repoOf(project), enabled: true, settings: {}, afterGreen: [] }]
    this.pools.set(project, rows)
    return rows
  }

  private poolOf(project: string): ProjectPool {
    const machines = this.rows(project)
    const others = this.machines
      .filter((machine) => machine.joinedAt !== null && machine.revokedAt === null && !machines.some((row) => row.id === machine.id))
      .map((machine) => {
        const root = machine.about?.root ?? '/home/example/projects'
        return { id: machine.id, name: machine.name, own: false, online: machine.online, folder: `${root}/${folderName(this.repoOf(project))}`, root }
      })
    const rows = machines.map((row) => ({ ...row, afterGreen: row.settings.afterGreen ?? FAKE_COMMANDS.afterGreen }))
    return { machines: rows, others, servers: FAKE_SERVERS, commands: FAKE_COMMANDS }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** The colours picked on the machines' pages and their capacities (BTN-1272), by machine. */
  private readonly colors = new Map<string, string | null>()
  private readonly capacities = new Map<string, number>()
  /** The git authors set from the page's window (BTN-1503), by machine. */
  private readonly identities = new Map<string, { name: string; email: string }>()
  /** With `?machines=taken` (BTN-1262), the laptop's first project's folder is held by a gone machine's mark until taken over. */
  private held: boolean

  /** Each machine of `names` with its colour, the picked one or the palette's by its place. */
  colorsOf(names: Record<string, string>): Record<string, string> {
    return machineColors(Object.keys(names).map((id) => ({ id, color: this.colors.get(id) ?? null })))
  }

  /**
   * The header panel's cards of the state's machines (BTN-1051), one lamp of each kind: the own one runs every
   * project; the laptop has git without a name (`?machines=nocli` — with one), off the link two hours ago with
   * `?machines=offline`; the desktop's Claude accounts are at a limit till 18:40 with `?machines=limit`.
   */
  cards(state: EvenKeelState): MachineCard[] {
    const names = state.machineNames ?? {}
    const colors = this.colorsOf(names)
    const own = state.ownMachine ?? OWN
    const until = new Date()
    until.setHours(18, 40, 0, 0)
    if (until.getTime() < Date.now()) until.setDate(until.getDate() + 1)
    const ids = [own, ...Object.keys(names).filter((id) => id !== own)]
    return ids.map((id): MachineCard => {
      const online = id === own || (this.machines.find((machine) => machine.id === id)?.online ?? true)
      // A card lists only the projects whose pool has the machine, as the server's does; the first project has every one.
      const pooled = state.projects
        .map((project, index) => {
          const row = this.pools.get(project)?.find((each) => each.id === id)
          const always = id === own || index === 0 || id === 'srv'
          // machine-1 lacks the first project's packages, as its page says: one to finish and the tracker's server (BTN-1300).
          const held = id === 'machine-1' && index === 0
          return {
            project,
            member: always || row !== undefined,
            enabled: always || row?.enabled === true,
            packagesBlocked: held,
            packagesUnready: held ? ['forgejo'] : [],
            trackerMissing: held ? 'huly' : null,
          }
        })
        .filter((each) => each.member)
        .map(({ member: _, ...each }) => each)
      return {
        id, name: names[id] ?? id, color: colors[id]!, own: id === own, online,
        offlineSince: online ? null : Date.now() - 2 * 3_600_000,
        ...this.cardGit(id),
        agents: this.agentsOf(state, id, id === own),
        limitedUntil: id === 'machine-2' && this.mode === 'limit' ? { claude: until.toISOString() } : {},
        projects: pooled,
        ...this.cardAccounts(state, id, id === own, until),
      }
    })
  }

  /** The laptop's git has no name (`?machines=nocli` — it has), until the page's window sets one (BTN-1503). */
  private cardGit(id: string): Pick<MachineCard, 'gitUser' | 'gitName' | 'gitEmail'> {
    const set = this.identities.get(id)
    if (set !== undefined) return { gitUser: true, gitName: set.name, gitEmail: set.email }
    if (id === 'machine-1' && this.mode !== 'nocli') return { gitUser: false }
    return { gitUser: true, gitName: 'John Doe', gitEmail: 'john.doe@example.com' }
  }

  /** The agents a machine has a signed-in account of: with `?machines=signIn` a machine elsewhere's are those its sign-ins posted. */
  private agentsOf(state: EvenKeelState, id: string, own: boolean): string[] {
    const posted = own || this.mode !== 'signIn' ? undefined : state.machineSignIns?.find((each) => each.machine === id)
    if (posted !== undefined) return [...new Set(posted.accounts.filter((each) => each.signedIn).map((each) => each.agent))]
    return own || id === 'machine-2' ? ['claude', 'codex'] : ['claude']
  }

  /**
   * The own machine's are the state's; the laptop is signed out of the second; the desktop's Claude is spent with `limit`.
   * With `?machines=…` a machine's are those its sign-ins posted (BTN-1302: the laptop has none).
   */
  private cardAccounts(state: EvenKeelState, id: string, own: boolean, until: Date): Pick<MachineCard, 'accounts' | 'active'> {
    const posted = own ? undefined : state.machineSignIns?.find((each) => each.machine === id)
    if (posted !== undefined) {
      const accounts = posted.accounts.map((each) => ({ ...each, name: null, limits: each.signedIn ? state.limits : null }))
      return { accounts, active: accounts.find((each) => each.signedIn)?.key ?? null }
    }
    const spent = { fiveHour: { usedPercentage: 100, resetsAt: until.toISOString() }, sevenDay: null, updatedAt: new Date().toISOString(), source: 'usage' } as unknown as NonNullable<EvenKeelState['limits']>
    const accounts = state.account.accounts.map((entry, index) => {
      const signedIn = own ? entry.status?.loggedIn === true : !(id === 'machine-1' && index > 0)
      const limits = own ? entry.limits : !signedIn ? null : id === 'machine-2' && this.mode === 'limit' && entry.agent === 'claude' ? spent : state.limits
      return { key: entry.key, agent: entry.agent, email: entry.status?.email ?? null, name: entry.name, signedIn, limits }
    })
    return { accounts, active: state.account.active }
  }

  /**
   * The page of a machine of the state's `machineNames` (BTN-1272): the own one reports Windows and runs the state's
   * sessions; the laptop is not signed in to the second account and the first project's packages are not ready there.
   */
  page(id: string, state: EvenKeelState): MachinePage | undefined {
    const names = state.machineNames ?? {}
    const name = names[id]
    if (name === undefined) return undefined
    const own = id === OWN
    const view = this.machines.find((machine) => machine.id === id)
    const told = own ? about('workstation', { os: 'win32 10.0.26200', root: null, agents: { claude: '2.1.322', codex: '0.98.0', opencode: null, copilot: null } }) : (view?.about ?? about(name.toLowerCase().replace(/\W+/g, '-')))
    const set = this.identities.get(id)
    const report = set === undefined ? told : { ...told, gitUser: true, gitName: set.name, gitEmail: set.email }
    // A machine elsewhere's accounts and missing CLIs are its panel's, as the hub's mirror has them.
    const panel = own ? undefined : state.machineSignIns?.find((each) => each.machine === id)
    const pooled = state.projects.filter((project) => own || this.pools.get(project)?.some((row) => row.id === id) || view?.projects.includes(project) || project === state.projects[0])
    const projects: MachineProject[] = pooled.map((project, index) => {
      const row = (own ? this.rows(project) : this.pools.get(project))?.find((each) => each.id === id)
      return {
        project,
        folder: row?.folder ?? `${report.root ?? '/home/example/projects'}/${folderName(this.repoOf(project))}`,
        enabled: row?.enabled ?? true,
        packagesBlocked: id === 'machine-1' && index === 0,
        packagesPause: null,
      }
    })
    const color = this.colors.get(id) ?? null
    return {
      id,
      name,
      own,
      online: own || (view?.online ?? true),
      joinedAt: own ? null : (view?.joinedAt ?? Date.now() - 86_000_000),
      about: report,
      hubVersion: '0.4.0',
      color: this.colorsOf(names)[id]!,
      picked: color !== null,
      palette: [...MACHINE_PALETTE],
      paletteColor: machineColors(Object.keys(names).map((each) => ({ id: each })))[id]!,
      capacity: this.capacities.get(id) ?? (own ? state.chain.parallel : 1),
      projects,
      accounts: own
        ? state.account.accounts.map((entry) => {
            const signedIn = entry.status?.loggedIn === true
            return { key: entry.key, agent: entry.agent, email: entry.status?.email ?? null, signedIn, limits: signedIn ? state.limits : null }
          })
        : (panel?.accounts ?? []).map((account) => ({ ...account, limits: account.signedIn ? state.limits : null })),
      missing: own ? [] : [...new Set([...(panel?.missing ?? []), ...Object.keys(report.agents).filter((agent) => report.agents[agent] === null)])],
      sessions: own ? state.sessions.filter((session) => session.lamp !== 'finished').map(({ task, sessionId, agent, model, lamp, cwd }) => ({ task, sessionId, agent, model, lamp, cwd })) : [],
      taken: id === 'machine-1' && this.held && pooled[0] !== undefined ? [{ project: pooled[0], machine: 'machine-0', name: 'Example old laptop' }] : [],
    }
  }

  /**
   * The machines' commands; `false` — another command, or one whose job is the state's. `machines/connect` puts the machine into the
   * pool turned off and answers `false` too: its job is the state's, `fakeMachineCommand`.
   */
  command(name: string, body: Record<string, unknown>): boolean {
    if (name === 'machines/capacity') {
      this.capacities.set(String(body.machine), Number(body.capacity))
      this.changed()
      return true
    }
    if (name === 'machines/gitIdentity') {
      this.identities.set(String(body.machine), { name: String(body.name), email: String(body.email) })
      this.changed()
      return true
    }
    if (name === 'machines/takeOver' && body.machine === 'machine-1' && this.held) {
      this.held = false
      this.changed()
      return true
    }
    if (name === 'machines/color') {
      this.colors.set(String(body.machine), typeof body.color === 'string' ? body.color : null)
      this.changed()
      return true
    }
    if (name === 'machines/enable') {
      const project = String(body.project)
      this.pools.set(project, this.rows(project).map((row) => (row.id === body.machine ? { ...row, enabled: body.enabled === true } : row)))
      this.changed()
      return true
    }
    if (name === 'machines/settings') {
      const project = String(body.project)
      const settings = body.settings as PoolMachine['settings']
      this.pools.set(project, this.rows(project).map((row) => (row.id === body.machine && !row.own ? { ...row, settings } : row)))
      this.changed()
      return true
    }
    if (name === 'machines/connect') {
      const project = String(body.project)
      const machine = this.machines.find((each) => each.id === body.machine)
      const rows = this.rows(project)
      if (machine !== undefined && !rows.some((row) => row.id === machine.id)) {
        const folder = String(body.folder ?? '').trim() || this.poolOf(project).others.find((each) => each.id === machine.id)?.folder || ''
        const settings = rows.find((row) => row.id === body.copyFrom)?.settings ?? {}
        // The fake's job fails on the laptop's push check: there the row stays off; elsewhere it is turned on.
        rows.push({ id: machine.id, name: machine.name, own: false, online: machine.online, folder, enabled: machine.id !== 'machine-1', settings: { ...settings }, afterGreen: [] })
      }
      this.changed()
      return false
    }
    if (name !== 'machines/join') return false
    // Its job is the state's (`fakeMachineCommand`); the projects the job connects show on the machine at once.
    const requests = (body.projects as JoinRequest[] | undefined) ?? []
    const failing = joinFailing(String(body.machine), requests)
    const projects = requests.map((each) => each.project).filter((project) => project !== failing)
    this.machines = this.machines.map((machine) => (machine.id === body.machine ? { ...machine, projects: [...new Set([...machine.projects, ...projects])] } : machine))
    this.changed()
    return false
  }
}

/** The command lists and the stdio servers every project of `dev:fake` has, for a machine's own ones (BTN-994). */
const FAKE_COMMANDS = { beforeStart: ['npm ci'], check: ['npm run typecheck', 'npm test'], afterGreen: ['npm run build'] }
const FAKE_SERVERS = [
  { package: 'files', server: 'files', command: 'npx', args: ['-y', 'example-files-mcp', '/home/example/shared'] },
  // A package whose server is named apart from it: its name shows the server as a tag (BTN-1381).
  { package: 'tracker', server: 'issues', command: 'npx', args: ['-y', 'example-issues-mcp'] },
]

/** The hub's own machine in `dev:fake`, as `?machines=…` names it in `machineNames`. */
const OWN = 'pc'
const OWN_NAME = 'Workstation'

/** The machine names of `?machines=…`: the hub's own and the two machines elsewhere, so the project's "Machines" shows. */
export const FAKE_MACHINE_NAMES: Record<string, string> = { [OWN]: OWN_NAME, 'machine-1': 'Example laptop', 'machine-2': 'Example desktop' }

/** `?machines=many` (BTN-1309): seven more machines elsewhere, ten with the hub's own. */
const MANY_NODES = [3, 4, 5, 6, 7, 8, 9]

/** The machine names of a `?machines=…` mode: `signIn` has a third machine elsewhere, off the link, for the wizard (BTN-1297). */
export const fakeMachineNames = (mode: string | null): Record<string, string> =>
  mode === 'many' ? { ...FAKE_MACHINE_NAMES, ...Object.fromEntries(MANY_NODES.map((node) => [`machine-${node}`, `Example node ${node}`])) }
  : mode === 'signIn' ? { ...FAKE_MACHINE_NAMES, 'machine-3': 'Example mini' }
  : FAKE_MACHINE_NAMES

/**
 * The wizard's probe of a folder on a machine (BTN-1297): a name with `clone` holds the project's clone, one with `taken`
 * another repository, any other is free.
 */
const folderProbe = (folder: string, remote: string): FolderProbe =>
  folder.includes('clone') ? { state: 'clone' } : folder.includes('taken') ? { state: 'taken', notice: notice('pool.foreignRepo', { folder, remote }) } : { state: 'free' }

/** The state's machine colours and own machine where `dev:fake` has several machines (BTN-1272): the palette's, `pc` own. */
export const fakeMachineColors = (names: Record<string, string>): Pick<EvenKeelState, 'machineColors' | 'ownMachine'> => ({
  machineColors: machineColors(Object.keys(names).map((id) => ({ id }))),
  ownMachine: OWN,
})

/**
 * `?chain=machinePackages|machineGateway|machineOld` (BTN-1524): the first project's lane went to the laptop and waits
 * there — for docs, which does not answer, and forgejo, still starting; for the laptop's MCP gateway; for packages an
 * older laptop only says are not ready. The hub's own set is fine. `?chain=machineLimits` (BTN-1521): the lane there
 * waits for the first limits poll of the laptop's account, the next one in 4 minutes.
 */
export function fakeMachineLaneWait(state: EvenKeelState, mode: string): void {
  type Lane = NonNullable<(typeof state.chain.active)[number]>
  const lane = state.chain.active[0]
  const waits: Record<string, Partial<Lane>> = {
    machinePackages: { packagesWait: { machine: 'machine-1', packages: [{ name: 'docs', problems: [{ kind: 'noResponse', servers: ['docs'] }] }, { name: 'forgejo', problems: [{ kind: 'probing' }] }] } },
    machineGateway: { packagesWait: { machine: 'machine-1', gateway: true, packages: [] } },
    machineOld: { packagesWait: { machine: 'machine-1', packages: [] } },
    machineLimits: { limitsWait: { account: 'laptop', next: new Date(Date.now() + 4 * 60_000).toISOString() } },
  }
  const wait = waits[mode]
  if (lane === undefined || wait === undefined) return
  state.machineNames = { ...FAKE_MACHINE_NAMES, ...state.machineNames }
  Object.assign(state, fakeMachineColors(state.machineNames))
  state.chain.active = [{ ...lane, machine: 'machine-1', current: null, ...wait }, ...state.chain.active.slice(1)]
}

const folderName = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').pop() ?? 'project'

const CONNECT_CHECKS = ['repo', 'remote', 'branch', 'trust', 'packages', 'push'].map((step) => `machine-${step}`)

/**
 * The job "Connect" starts (BTN-1271): done at once, except on the laptop, whose push check fails with what to do.
 */
function connectJob(state: EvenKeelState, body: Record<string, unknown>): StepJob {
  const machine = String(body.machine)
  const ids = [...(body.clone === true ? ['machine-clone'] : []), 'machine-place', ...CONNECT_CHECKS, 'machine-enable']
  const failing = machine === 'machine-1' ? ids.indexOf('machine-push') : -1
  const at = new Date().toISOString()
  const steps: JobStep[] = ids.map((id, index) =>
    failing === -1 || index < failing ? { id, state: 'done', startedAt: at, endedAt: at } : index === failing ? { id, state: 'failed', startedAt: at, endedAt: at } : { id, state: 'waiting' },
  )
  return {
    id: `job-machine-${Date.now()}`,
    kind: 'machine',
    subject: state.machineNames?.[machine] ?? machine,
    project: String(body.project),
    steps,
    failure: failing === -1 ? null : notice('pool.noPush', { remote: 'https://git.example.com/acme/abc.git' }),
    done: failing === -1,
    undoable: failing !== -1,
  }
}

/** The project whose push check fails in the fake's "Connect" of the window "Add a machine": the laptop's last. */
const joinFailing = (machine: string, requests: JoinRequest[]): string | undefined => (machine === 'machine-1' && requests.length > 1 ? requests.at(-1)?.project : undefined)

/**
 * The job "Connect" of the window "Add a machine" starts (BTN-1263): each project's steps done at once, except on the
 * laptop with more than one project, where the last one's push check fails with what to do.
 */
function joinJob(state: EvenKeelState, body: Record<string, unknown>): StepJob {
  const machine = String(body.machine)
  const requests = (body.projects as JoinRequest[] | undefined) ?? []
  const failing = joinFailing(machine, requests)
  const at = new Date().toISOString()
  let failed = false
  const steps: JobStep[] = requests.flatMap(({ project, clone }) =>
    [...(clone ? ['machine-clone'] : []), 'machine-place', ...CONNECT_CHECKS, 'machine-enable'].map((step): JobStep => {
      const id = `${step}@${project}`
      if (failed) return { id, state: 'waiting' }
      if (project === failing && step === 'machine-push') {
        failed = true
        return { id, state: 'failed', startedAt: at, endedAt: at }
      }
      return { id, state: 'done', startedAt: at, endedAt: at }
    }),
  )
  return {
    id: `job-join-${Date.now()}`,
    kind: JOIN_KIND,
    subject: state.machineNames?.[machine] ?? (machine === 'machine-1' ? 'Example laptop' : machine),
    steps,
    failure: failed ? notice('pool.noPush', { remote: `https://git.example.com/acme/${(state.projectKeys[failing!] ?? 'abc').toLowerCase()}.git` }) : null,
    done: !failed,
    undoable: failed,
  }
}

/**
 * `?machines=signIn|login|offline|nocli` (BTN-1245): a machine elsewhere where the active Claude account is not signed
 * in; `login` with its sign-in under way, `offline` gone from the link, `nocli` without the Claude CLI, `token` with the
 * other machine on long tokens (BTN-1002), `tokenAlone` on long tokens of the hub's Claude folders signed out, so no
 * machine polls them (BTN-1266; with `?accounts=tokenOnly`), `tokenDiffer` on long tokens whose windows differ from
 * the hub's poll (BTN-1267). Its commands go through `fakeMachineCommand`.
 */
export function fakeMachineSignIns(state: EvenKeelState, mode: string | null): MachineSignIn[] | undefined {
  if (mode === null) return undefined
  const alone = mode === 'tokenAlone'
  const differ = mode === 'tokenDiffer'
  const desktop: MachineSignIn = {
    machine: 'machine-2', name: 'Example desktop', online: true, login: null, missing: [],
    accounts: state.account.accounts
      .filter((entry) => (alone ? entry.longToken === undefined && entry.lastEmail != null : entry.status?.loggedIn === true))
      .map((entry) => ({
        key: entry.key, agent: entry.agent, email: entry.status?.email ?? entry.lastEmail ?? null, signedIn: true,
        ...((mode === 'token' || alone || differ) && { longToken: true as const }),
        ...(alone && { sessionsOnly: true as const }),
        ...(differ && { limitsDiffer: true as const }),
      })),
  }
  const laptop: MachineSignIn = {
    machine: 'machine-1', name: 'Example laptop', online: mode !== 'offline', login: null, missing: mode === 'nocli' ? ['claude'] : [], accounts: [],
  }
  if (mode === 'many') return [...manyMachines(state, laptop), desktop]
  const machines = [laptop, desktop]
  return mode === 'login' ? machines.map((machine) => (machine === laptop ? { ...machine, login: loginOf('claude', null) } : machine)) : machines
}

/**
 * `many`: the laptop keeps the active account's folder signed out, the nodes run it — 5 and 6 on long tokens, 9 off
 * the link — so its row has nine machines, four labels and "+5".
 */
function manyMachines(state: EvenKeelState, laptop: MachineSignIn): MachineSignIn[] {
  const active = state.account.accounts.find((entry) => entry.key === state.account.active)
  const email = active?.status?.email ?? null
  const account = { key: active?.key ?? 'work', agent: active?.agent ?? 'claude', email }
  return [
    { ...laptop, accounts: [{ ...account, signedIn: false }] },
    ...MANY_NODES.map((node): MachineSignIn => ({
      machine: `machine-${node}`, name: `Example node ${node}`, online: node !== 9, login: null, missing: [],
      accounts: [{ ...account, signedIn: true, ...((node === 5 || node === 6) && { longToken: true as const }) }],
    })),
  ]
}

const loginOf = (agent: string, target: string | null): MachineSignIn['login'] => ({
  agent, target, startedAt: new Date().toISOString(), urls: ['https://claude.ai/oauth/authorize?code=true&client_id=example'],
  deviceCode: null, output: 'Opening browser to sign in…\nPaste code here if prompted >', error: null, codeSent: false,
})

/** The machines' sign-in commands on the fake state; `null` — not one of them. */
export function fakeMachineCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name === 'machines/connect') return { ...state, jobs: [...(state.jobs ?? []), connectJob(state, body)] }
  if (name === 'machines/join') return { ...state, jobs: [...(state.jobs ?? []), joinJob(state, body)] }
  const machines = state.machineSignIns
  if (machines === undefined || !name.startsWith('machines/')) return null
  const change = (machine: string, patch: (each: MachineSignIn) => MachineSignIn): EvenKeelState => ({
    ...state, machineSignIns: machines.map((each) => (each.machine === machine ? patch(each) : each)),
  })
  const machine = String(body.machine)
  if (name === 'machines/login') return change(machine, (each) => ({ ...each, login: loginOf(String(body.agent ?? 'claude'), typeof body.account === 'string' ? body.account : null) }))
  if (name === 'machines/cancel') return change(machine, (each) => ({ ...each, login: null }))
  if (name === 'machines/token') {
    const hub = state.account.accounts.find((entry) => entry.key === body.account)
    return change(machine, (each) => ({
      ...each,
      accounts: [...each.accounts, { key: 'token', agent: 'claude', email: hub?.status?.email ?? null, signedIn: true, longToken: true }],
    }))
  }
  if (name === 'machines/sharedToken') {
    const from = state.account.accounts.find((entry) => entry.key === body.from)
    const same = state.account.accounts.find((entry) => entry.key === from?.longToken?.sameAs)
    return change(machine, (each) => ({
      ...each,
      accounts: [...each.accounts, { key: String(body.from), agent: 'claude', email: same?.status?.email ?? null, signedIn: true, longToken: true }],
    }))
  }
  if (name === 'machines/code') {
    const active = state.account.accounts.find((entry) => entry.key === state.account.active)
    return change(machine, (each) => ({
      ...each, login: null,
      accounts: [...each.accounts, { key: active?.status?.email ?? 'john.doe@example.com', agent: 'claude', email: active?.status?.email ?? null, signedIn: true }],
    }))
  }
  return null
}
