import { describe, expect, it } from 'vitest'
import { escalated, shellCall } from './wire.fixture.js'

describe('shellCall', () => {
  it('takes the shell tool among the offered ones', () => {
    expect(shellCall(['read', 'exec_command'], 'ls')).toEqual({ name: 'exec_command', args: { cmd: 'ls' } })
  })

  it("asks Codex to run a git command outside its sandbox, which keeps the main checkout's .git read-only off Windows", () => {
    expect(escalated('git commit --allow-empty -m "[ABC-1] Work"', 'linux')).toMatchObject({ sandbox_permissions: 'require_escalated' })
    expect(escalated('git merge --no-edit abc-1/task', 'darwin')).toMatchObject({ sandbox_permissions: 'require_escalated' })
    expect(escalated('git commit -m x', 'win32')).toEqual({})
    expect(escalated('ls', 'linux')).toEqual({})
    expect(shellCall(['exec_command'], 'git status')?.args).toEqual({ cmd: 'git status', ...escalated('git status') })
    expect(shellCall(['bash'], 'git commit -m x')?.args).not.toHaveProperty('sandbox_permissions')
  })

  it('takes no name of Object.prototype for a shell tool', () => {
    expect(shellCall(['constructor', 'toString', '__proto__'], 'ls')).toBeNull()
  })
})
