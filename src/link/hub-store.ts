import { inTransaction, type Db } from '../storage/database.js'
import type { Command, NumberedCommand } from './protocol.js'

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
}

/** What the hub keeps about its machines' links: the tokens, the commands not confirmed yet and the last event taken. */
export interface HubStore {
  machine(id: string): Promise<MachineRecord | undefined>
  addMachine(machine: Pick<MachineRecord, 'id' | 'name' | 'secretHash' | 'createdAt'>): Promise<void>
  revoke(id: string, at: number): Promise<void>
  seen(id: string, host: string, api: number, at: number): Promise<void>
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
}

/** The hub's side in the state database: `machines` and `machine_commands` (step 51). */
export class DatabaseHubStore implements HubStore {
  constructor(private readonly db: Db) {}

  async machine(id: string): Promise<MachineRecord | undefined> {
    const { rows } = await this.db.query<MachineRow>('select id, name, secret_hash, created_at, revoked_at, host, last_event from machines where id = $1', [id])
    const row = rows[0]
    if (row === undefined) return undefined
    return {
      id: row.id,
      name: row.name,
      secretHash: row.secret_hash,
      createdAt: Number(row.created_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
      host: row.host,
      lastEvent: Number(row.last_event),
    }
  }

  async addMachine(machine: Pick<MachineRecord, 'id' | 'name' | 'secretHash' | 'createdAt'>): Promise<void> {
    await this.db.query('insert into machines (id, name, secret_hash, created_at) values ($1, $2, $3, $4)', [machine.id, machine.name, machine.secretHash, machine.createdAt])
  }

  async revoke(id: string, at: number): Promise<void> {
    await this.db.query('update machines set revoked_at = $2 where id = $1 and revoked_at is null', [id, at])
  }

  async seen(id: string, host: string, api: number, at: number): Promise<void> {
    await this.db.query('update machines set host = $2, api = $3, seen_at = $4 where id = $1', [id, host, api, at])
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
