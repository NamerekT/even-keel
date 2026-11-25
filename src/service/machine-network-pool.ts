import type { CloneProgress } from '../git/clone-progress.js'
import type { MachineRecord } from '../link/hub-store.js'
import { ASSIGN_COMMAND } from '../link/protocol.js'
import type { MachineProjectSettings, ProjectPool } from '../link/view.js'
import type { MachineFolders } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import { insideRoot, type NetworkHost, type PoolTarget } from './machine-network-options.js'
import { afterGreenOn, settingsColumn, settingsFromColumn } from './machine-settings.js'

/** The projects of the machine's pool, each with its folder there and whether the machine takes its tasks. */
export async function foldersOf(host: NetworkHost, machine: string): Promise<Array<{ project: string; folder: string; enabled: boolean }>> {
  const own = machine === host.options.own()
  const root = own ? null : ((await host.options.store.machine(machine))?.about?.root ?? null)
  const { rows } = await host.options.db.query<{ project_id: string; folder: string | null; enabled: boolean }>(
    'select project_id, folder, enabled from project_machines where machine_id = $1 order by project_id',
    [machine],
  )
  return rows.flatMap((row) => {
    const folder = own ? host.options.repoOf(row.project_id) : host.folderOf(row.project_id, row.folder, root)
    return folder === undefined ? [] : [{ project: row.project_id, folder, enabled: row.enabled }]
  })
}

/**
 * Puts the machine into the pools of the projects and tells it the folder of each: inside its folder of projects,
 * named as on the hub. The machine agrees to it by itself; a folder outside its root it refuses.
 */
export async function attach(host: NetworkHost, machine: string, projects: string[]): Promise<void> {
  const record = await host.foreign(machine)
  if (record.joinedAt === null) throw fail('machines.notJoined', {})
  const root = record.about?.root ?? null
  if (root === null) throw fail('machines.noRoot', {})
  const repos = projects.map((project) => [project, host.options.repoOf(project)] as const)
  if (repos.some(([, repo]) => repo === undefined)) throw fail('machines.unknownProject', {})
  for (const [project] of repos) {
    await host.options.db.query(
      'insert into project_machines (project_id, machine_id) values ($1, $2) on conflict (project_id, machine_id) do update set enabled = true',
      [project, record.id],
    )
    host.taken.get(record.id)?.delete(project)
    await host.hub.send(record.id, { type: ASSIGN_COMMAND, project, folder: (await host.folderOn(record.id, project, root))! })
  }
  await host.refresh()
  host.options.log(`machines: machine ${record.id} (${record.name}) was given ${projects.length} project(s)`)
  if (host.hub.connected(record.id)) void host.brief(record.id)
  host.options.changed()
}

/** The project's pool for its section "Machines" (BTN-1271): the own machine's folder is the project's repository. */
export async function pool(host: NetworkHost, project: string): Promise<ProjectPool> {
  const repo = host.options.repoOf(project)
  if (repo === undefined) throw fail('machines.unknownProject', {})
  const own = host.options.own()
  const records = (await host.options.store.listMachines()).filter((record) => record.revokedAt !== null ? false : record.id === own || record.joinedAt !== null)
  const { rows } = await host.options.db.query<{ machine_id: string; folder: string | null; enabled: boolean; settings: string | null }>(
    'select machine_id, folder, enabled, settings from project_machines where project_id = $1 order by machine_id',
    [project],
  )
  const settings = host.options.projectSettings?.(project)
  const folderIn = (record: MachineRecord, folder: string | null) => (record.id === own ? repo : host.folderOf(project, folder, record.about?.root ?? null) ?? null)
  const online = (record: MachineRecord) => record.id === own || host.hub.connected(record.id)
  return {
    machines: rows.flatMap((row) => {
      const record = records.find((each) => each.id === row.machine_id)
      if (record === undefined) return []
      const isOwn = record.id === own
      const values = isOwn ? {} : settingsFromColumn(row.settings)
      return [{ id: record.id, name: record.name, own: isOwn, online: online(record), folder: folderIn(record, row.folder) ?? '', enabled: row.enabled, settings: values, afterGreen: afterGreenOn(settings, values) }]
    }),
    others: records
      .filter((record) => !rows.some((row) => row.machine_id === record.id))
      .map((record) => ({
        id: record.id,
        name: record.name,
        own: record.id === own,
        online: online(record),
        folder: folderIn(record, null),
        root: record.id === own ? null : (record.about?.root ?? null),
      })),
    servers: host.options.servers?.(project) ?? [],
    ...(settings !== undefined && { commands: { beforeStart: settings.beforeStart, check: settings.check, afterGreen: settings.afterGreen } }),
  }
}

/**
 * Keeps a machine elsewhere's own values in the project (BTN-994) and briefs it: its next session, check and command
 * after a green main take them. The own machine has none: its values are the project's.
 */
export async function setSettings(host: NetworkHost, project: string, machine: string, values: MachineProjectSettings): Promise<void> {
  if (host.options.repoOf(project) === undefined) throw fail('machines.unknownProject', {})
  if (machine === host.options.own()) throw fail('pool.ownMachine', {})
  const record = await host.foreign(machine)
  const { rows } = await host.options.db.query('update project_machines set settings = $3 where project_id = $1 and machine_id = $2 returning machine_id', [project, record.id, settingsColumn(values)])
  if (rows.length === 0) throw fail('pool.notInPool', {})
  host.options.log(`machines: machine ${record.id} (${record.name}) has its own values in project ${project}: ${Object.keys(values).join(', ') || 'none'}`)
  await poolChanged(host, record.id)
}

/**
 * The machines of the project's pool turned on, each with the commands after a green main it runs and the last green
 * commit they were started on there (BTN-994); `machine` — only that one.
 */
export async function afterGreenPool(host: NetworkHost, project: string, machine?: string): Promise<Array<{ machine: string; commands: string[]; ran: string | null }>> {
  const { rows } = await host.options.db.query<{ machine_id: string; settings: string | null; after_green: string | null }>(
    'select machine_id, settings, after_green from project_machines where project_id = $1 and enabled and ($2::text is null or machine_id = $2) order by machine_id',
    [project, machine ?? null],
  )
  const own = host.options.own()
  const settings = host.options.projectSettings?.(project)
  return rows.map((row) => ({ machine: row.machine_id, commands: afterGreenOn(settings, row.machine_id === own ? {} : settingsFromColumn(row.settings)), ran: row.after_green }))
}

/** The projects whose pool has the machine turned on. */
export async function projectsOf(host: NetworkHost, machine: string): Promise<string[]> {
  const { rows } = await host.options.db.query<{ project_id: string }>('select project_id from project_machines where machine_id = $1 and enabled order by project_id', [machine])
  return rows.map((row) => row.project_id)
}

/** The mark of the green commit the machine's commands after a green main start on, written before they start. */
export async function markAfterGreen(host: NetworkHost, project: string, machine: string, commit: string): Promise<void> {
  await host.options.db.query('update project_machines set after_green = $3 where project_id = $1 and machine_id = $2', [project, machine, commit])
}

/**
 * Turns the machine's taking of the project's tasks on or off; a task it holds goes on either way. The own machine
 * is put into the pool by this alone: its folder is the project's repository, checked when the project was added.
 */
export async function setEnabled(host: NetworkHost, project: string, machine: string, enabled: boolean): Promise<void> {
  if (host.options.repoOf(project) === undefined) throw fail('machines.unknownProject', {})
  if (machine === host.options.own()) {
    await host.options.db.query(
      'insert into project_machines (project_id, machine_id, enabled) values ($1, $2, $3) on conflict (project_id, machine_id) do update set enabled = $3',
      [project, machine, enabled],
    )
  } else {
    const record = await host.foreign(machine)
    const { rows } = await host.options.db.query('update project_machines set enabled = $3 where project_id = $1 and machine_id = $2 returning machine_id', [project, record.id, enabled])
    if (rows.length === 0) throw fail('pool.notInPool', {})
  }
  host.options.log(`machines: machine ${machine} ${enabled ? 'takes' : 'no longer takes'} the tasks of project ${project}`)
  await poolChanged(host, machine)
}

/** A machine elsewhere the project may be connected to: joined, with a folder of projects; the own one is refused. */
export async function target(host: NetworkHost, machine: string): Promise<PoolTarget> {
  if (machine === host.options.own()) throw fail('pool.ownMachine', {})
  const record = await host.foreign(machine)
  if (record.joinedAt === null) throw fail('machines.notJoined', {})
  const root = record.about?.root ?? null
  if (root === null) throw fail('machines.noRoot', {})
  return { id: record.id, name: record.name, root }
}

/** The folders group of a machine connected now. */
export function folders(host: NetworkHost, target: PoolTarget): MachineFolders {
  const peer = host.peers.get(target.id)
  if (host.tooLarge.has(target.id)) throw fail('machines.tooLarge', { name: target.name })
  if (peer === undefined || !host.hub.connected(target.id)) throw fail('pool.offline', { name: target.name })
  return peer.remote.services().folders
}

/** Shows a clone's progress on the machine until the returned function is called. */
export function watchClone(host: NetworkHost, machine: string, project: string, show: (progress: CloneProgress) => void): () => void {
  const key = `${machine}\0${project}`
  host.clones.set(key, show)
  return () => {
    if (host.clones.get(key) === show) host.clones.delete(key)
  }
}

/**
 * Puts the project's folder on the machine into its pool turned off, tells the machine the folder and briefs it, so
 * its packages install before the checks. Answers whether the row is new: Cancel takes back only such a row.
 * `copyFrom` — a machine of the pool whose own values in the project this one takes (BTN-994).
 */
export async function place(host: NetworkHost, target: PoolTarget, project: string, folder: string, copyFrom?: string): Promise<boolean> {
  if (!insideRoot(folder, target.root)) throw fail('pool.outside', { folder, root: target.root })
  const { rows } = await host.options.db.query<{ enabled: boolean }>('select enabled from project_machines where project_id = $1 and machine_id = $2', [project, target.id])
  await host.options.db.query(
    `insert into project_machines (project_id, machine_id, enabled, folder) values ($1, $2, false, $3)
     on conflict (project_id, machine_id) do update set folder = $3`,
    [project, target.id, folder],
  )
  if (copyFrom !== undefined && copyFrom !== target.id) {
    const copied = await host.options.db.query<{ settings: string | null }>('select settings from project_machines where project_id = $1 and machine_id = $2', [project, copyFrom])
    if (copied.rows.length === 0) throw fail('pool.notInPool', {})
    await host.options.db.query('update project_machines set settings = $3 where project_id = $1 and machine_id = $2', [project, target.id, copied.rows[0]!.settings])
  }
  host.taken.get(target.id)?.delete(project)
  await host.hub.send(target.id, { type: ASSIGN_COMMAND, project, folder })
  host.options.log(`machines: machine ${target.id} (${target.name}) is given the folder ${folder} of project ${project}, to be checked`)
  await poolChanged(host, target.id)
  return rows.length === 0
}

/** Takes the machine out of the project's pool: Cancel of a connection that put it there. */
export async function unplace(host: NetworkHost, machine: string, project: string): Promise<void> {
  await host.options.db.query('delete from project_machines where project_id = $1 and machine_id = $2', [project, machine])
  await poolChanged(host, machine)
}

async function poolChanged(host: NetworkHost, machine: string): Promise<void> {
  await host.refresh()
  if (host.hub.connected(machine)) await host.brief(machine)
  host.options.changed()
}
