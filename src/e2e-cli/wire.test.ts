import { describe, expect, it } from 'vitest'
import { shellCall } from './wire.fixture.js'

describe('shellCall', () => {
  it('takes the shell tool among the offered ones', () => {
    expect(shellCall(['read', 'exec_command'], 'ls')).toEqual({ name: 'exec_command', args: { cmd: 'ls' } })
  })

  it('takes no name of Object.prototype for a shell tool', () => {
    expect(shellCall(['constructor', 'toString', '__proto__'], 'ls')).toBeNull()
  })
})
