import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { SCHEMA_VERSION } from '../storage/schema.js'

const parsed = (memoryMirror: unknown) => parseConfig({ version: SCHEMA_VERSION, projects: [], memoryMirror }).memoryMirror
const refused = (code: string) => expect.objectContaining({ notice: expect.objectContaining({ code }) })

describe('the memory mirror setting (BTN-1649)', () => {
  it('is off by default and for an empty address', () => {
    expect(parseConfig({ version: SCHEMA_VERSION, projects: [] }).memoryMirror).toBeNull()
    expect(parsed('  ')).toBeNull()
    expect(parsed(null)).toBeNull()
  })

  it.each(['git@example.com:backup/memory.git', 'ssh://git@example.com:2222/backup/memory.git', 'https://john@example.com/backup/memory.git', '/srv/memory.git', 'D:\\copies\\memory.git'])(
    'takes the address %s',
    (address) => {
      expect(parsed(` ${address} `)).toBe(address)
    },
  )

  it.each(['git@example.com: memory.git', '--upload-pack=x', 3])('refuses the address %s', (address) => {
    expect(() => parsed(address)).toThrow(refused('config.memoryMirror'))
  })

  it('refuses an address with a password, never showing it', () => {
    expect(() => parsed('https://john:secret@example.com/memory.git')).toThrow(refused('config.memoryMirrorPassword'))
  })
})
