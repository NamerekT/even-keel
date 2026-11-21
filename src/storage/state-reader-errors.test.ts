import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { databaseDirOf, readOwner, type StateDatabase } from './owner.js'
import { prepareDatabase } from './state-files.js'

// BTN-1437: PGlite before 0.5.17 answered a failed extended-protocol message with a ReadyForQuery of its own and the
// Sync with another one. A reader in another process got the second one as the answer to its next query, and every
// answer after it went one query late. In one process both usually come in one chunk and pg.Client hides the extra
// one, so the test reads the owner's port message by message.

const message = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(5)
  head.write(type, 0)
  head.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([head, body])
}
const text = (value: string) => Buffer.from(`${value}\0`)
const int16 = (value: number) => Buffer.from([value >> 8, value & 0xff])
const int32 = (value: number) => {
  const bytes = Buffer.alloc(4)
  bytes.writeInt32BE(value)
  return bytes
}
const startup = () => {
  const body = Buffer.concat([int32(196608), text('user'), text('postgres'), text('database'), text('postgres'), Buffer.from([0])])
  return Buffer.concat([int32(body.length + 4), body])
}
/** Parse, Bind, Describe, Execute and Sync of one query with text parameters — what pg.Client sends for it. */
const extended = (sql: string, params: string[]) =>
  Buffer.concat([
    message('P', text(''), text(sql), int16(0)),
    message('B', text(''), text(''), int16(0), int16(params.length), ...params.flatMap((p) => [int32(Buffer.byteLength(p)), Buffer.from(p)]), int16(0)),
    message('D', Buffer.from('P'), text('')),
    message('E', text(''), int32(0)),
    message('S'),
  ])

/** The backend's messages as letters, a data row with its first column's text. */
class Wire {
  private buffer = Buffer.alloc(0)
  readonly seen: string[] = []
  private wake: (() => void) | undefined

  constructor(readonly socket: Socket) {
    socket.on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data])
      while (this.buffer.length >= 5 && this.buffer.length >= this.buffer.readInt32BE(1) + 1) {
        const length = this.buffer.readInt32BE(1)
        const type = String.fromCharCode(this.buffer[0]!)
        const body = this.buffer.subarray(5, length + 1)
        this.buffer = this.buffer.subarray(length + 1)
        this.seen.push(type === 'D' ? `D:${body.subarray(6).toString()}` : type)
      }
      this.wake?.()
    })
  }

  /** Waits until `count` ReadyForQuery messages have come in all. */
  async readies(count: number): Promise<void> {
    while (this.seen.filter((type) => type === 'Z').length < count) await new Promise<void>((resolve) => (this.wake = resolve))
  }
}

describe('the owner port after a failed query with parameters', { timeout: 120_000 }, () => {
  let dir: string
  let owner: StateDatabase

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-reader-'))
    const stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    owner = await prepareDatabase({ stateDir, log: () => {} })
  })
  afterEach(async () => {
    await owner.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers it with one ReadyForQuery, and each next query with its own rows', async () => {
    const { port } = (await readOwner(databaseDirOf(join(dir, 'state'))))!
    const socket = connect(port!, '127.0.0.1')
    const wire = new Wire(socket)
    try {
      await new Promise((resolve) => socket.once('connect', resolve))
      socket.write(startup())
      await wire.readies(1)
      const rounds = [
        extended('select 1 as a where $1::int = 1', ['1']),
        extended(`select $1::text ~ '[' as bad`, ['x']),
        extended('select 2 as b where $1::int = 1', ['1']),
        extended('select 3 as c where $1::int = 1', ['1']),
        extended('select 4 as d where $1::int = 1', ['1']),
      ]
      for (const [n, round] of rounds.entries()) {
        socket.write(round)
        await wire.readies(n + 2)
      }
      const answers = wire.seen.slice(wire.seen.indexOf('Z') + 1).filter((type) => type !== 'S')
      expect(answers).toEqual(['1', '2', 'T', 'D:1', 'C', 'Z', '1', 'E', 'Z', '1', '2', 'T', 'D:2', 'C', 'Z', '1', '2', 'T', 'D:3', 'C', 'Z', '1', '2', 'T', 'D:4', 'C', 'Z'])
    } finally {
      socket.on('error', () => {})
      await new Promise((resolve) => socket.end(message('X'), resolve))
    }
  })
})
