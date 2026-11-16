import { inTransaction, type Db } from '../storage/database.js'
import type { Command, MachineAbout, NumberedCommand } from './protocol.js'

export interface MachineRecord {
  id: string
  name: string
  /** SHA-256 of the connection token's secret. */
  secretHash: string
  createdAt: number
  revokedAt: number | null
  /** The host the machine named at its last handshake. */
  host: string | null
  /** The highest event number taken from the machine. */
  lastEvent: number
  /** Until when its connection string can be joined with; `null` — a machine made without one (the hub's own). */
  inviteExpires: number | null
  /** When a machine joined with its connection string; until then the string's secret opens nothing but the join. */
  joinedAt: number | null
  /** What the machine told about itself last (BTN-1242). */
  about: MachineAbout | null
}

export type NewMachine = Pick<MachineRecord, 'id' | 'name' | 'secretHash' | 'createdAt'> & { inviteExpires?: number }

/** What the hub keeps about its machines' links: the tokens, the commands not confirmed yet and the last event taken. */
export interface HubStore {
  machine(id: string): Promise<MachineRecord | undefined>
  addMachine(machine: NewMachine): Promise<void>
  /** Every machine, the revoked ones too: for the hub's page. */
  listMachines(): Promise<MachineRecord[]>
  revoke(id: string, at: number): Promise<void>
  seen(id: string, host: string, api: number, at: number): Promise<void>
  /** The machine joined with its string: its own secret replaces the string's, once. `false` — it had joined already. */
  joined(id: string, secretHash: string, about: MachineAbout, at: number): Promise<boolean>
  described(id: string, about: MachineAbout): Promise<void>
  /** Keeps the command under the machine's next number. */
  addCommand(id: string, command: Command, at: number): Promise<number>
  commandsAfter(id: string, seq: number): Promise<NumberedCommand[]>
  dropCommands(id: string, upTo: number): Promise<void>
  eventTaken(id: string, seq: number): Promise<void>
}

interface MachineRow {
  id: string
  name: string
  secret_hash: string
  created_at: string
  revoked_at: string | null
  host: string | null
  last_event: string
  invite_expires?: string | null
  joined_at?: string | null
  about?: string | null
}

const countOf = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value))

/** Read with `*`: the stores of the steps before 55 are read through this one too. */
function recordOf(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    name: row.name,
    secretHash: row.secret_hash,
    createdAt: Number(row.created_at),
    revokedAt: countOf(row.revoked_at),
    host: row.host,
    lastEvent: Number(row.last_event),
    inviteExpires: countOf(row.invite_expires),
    joinedAt: countOf(row.joined_at),
    about: row.about === null || row.about === undefined ? null : (JSON.parse(row.about) as MachineAbout),
  }
}

/** The hub's side in the state database: `machines` and `machine_commands` (step 51). */
export class DatabaseHubStore implements HubStore {
  constructor(private readonly db: Db) {}

  async machine(id: string): Promise<MachineRecord | undefined> {
    const { rows } = await this.db.query<MachineRow>('select * from machines where id = $1', [id])
    return rows[0] === undefined ? undefined : recordOf(rows[0])
  }

  async listMachines(): Promise<MachineRecord[]> {
    const { rows } = await this.db.query<MachineRow>('select * from machines order by created_at, id')
    return rows.map(recordOf)
  }

  async addMachine(machine: NewMachine): Promise<void> {
    const values = [machine.id, machine.name, machine.secretHash, machine.createdAt]
    // The hub's own machine has no string to join with: made before step 55 runs (step 52's own machine), it names no new column.
    if (machine.inviteExpires === undefined) {
      await this.db.query('insert into machines (id, name, secret_hash, created_at) values ($1, $2, $3, $4)', values)
      return
    }
    await this.db.query('insert into machines (id, name, secret_hash, created_at, invite_expires) values ($1, $2, $3, $4, $5)', [...values, machine.inviteExpires])
  }

  async revoke(id: string, at: number): Promise<void> {
    await this.db.query('update machines set revoked_at = $2 where id = $1 and revoked_at is null', [id, at])
  }

  async seen(id: string, host: string, api: number, at: number): Promise<void> {
    await this.db.query('update machines set host = $2, api = $3, seen_at = $4 where id = $1', [id, host, api, at])
  }

  async joined(id: string, secretHash: string, about: MachineAbout, at: number): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      'update machines set secret_hash = $2, about = $3, joined_at = $4 where id = $1 and joined_at is null and revoked_at is null returning id',
      [id, secretHash, JSON.stringify(about), at],
    )
    return rows.length > 0
  }

  async described(id: string, about: MachineAbout): Promise<void> {
    await this.db.query('update machines set about = $2 where id = $1', [id, JSON.stringify(about)])
  }

  addCommand(id: string, command: Command, at: number): Promise<number> {
    return inTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{ last_command: string }>('update machines set last_command = last_command + 1 where id = $1 returning last_command', [id])
      if (rows[0] === undefined) throw new Error(`link: no machine ${id}`)
      const seq = Number(rows[0].last_command)
      await tx.query('insert into machine_commands (machine_id, seq, command, created_at) values ($1, $2, $3, $4)', [id, seq, JSON.stringify(command), at])
      return seq
    })
  }

  async commandsAfter(id: string, seq: number): Promise<NumberedCommand[]> {
    const { rows } = await this.db.query<{ seq: string; command: string }>('select seq, command from machine_commands where machine_id = $1 and seq > $2 order by seq', [id, seq])
    return rows.map((row) => ({ ...(JSON.parse(row.command) as Command), seq: Number(row.seq) }))
  }

  async dropCommands(id: string, upTo: number): Promise<void> {
    await this.db.query('delete from machine_commands where machine_id = $1 and seq <= $2', [id, upTo])
  }

  async eventTaken(id: string, seq: number): Promise<void> {
    await this.db.query('update machines set last_event = $2 where id = $1 and last_event < $2', [id, seq])
  }
}
