import { describe, expect, it } from 'vitest'
import { DEFAULT_PROTECTION, PROTECTION_GROUPS } from '../sessions/protection.js'
import { sessionConfig } from './cli.js'
import { server } from './protection-plugin.js'

type Config = Parameters<Awaited<ReturnType<typeof server>>['config']>[0]
type Permission = NonNullable<Config['permission']>

// The native harness flattens entries in order and uses the last matching rule.
function decision(permission: Permission, tool: string, command = '*') {
  const matches = (value: string, pattern: string) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$').test(value)
  let action = 'ask'
  for (const [name, value] of Object.entries(typeof permission === 'string' ? { '*': permission } : permission)) {
    if (!matches(tool, name)) continue
    for (const [pattern, next] of Object.entries(typeof value === 'string' ? { '*': value } : value)) {
      if (matches(command, pattern)) action = next
    }
  }
  return action
}

async function apply(config: Config, protection = DEFAULT_PROTECTION) {
  const launch = JSON.parse(sessionConfig({ protection }, [], []))
  const hooks = await server({}, launch.plugin.at(-1)[1])
  await hooks.config(config)
}

describe('Protection after OpenCode config merging', () => {
  it.each<Permission>([
    'allow',
    { '*': 'allow', bash: 'allow', plugin_huly_huly_delete_issue: 'allow' },
    { bash: { 'git push --force*': 'allow', 'git *': 'allow', '*': 'allow' }, plugin_huly_huly_delete_issue: 'allow', 'plugin_huly_*': 'allow', '*': 'allow' },
  ])('keeps denies after scalar, broad and specific agent allows: %j', async permission => {
    const config: Config = { permission, agent: { build: { permission }, custom: { permission } } }
    await apply(config)
    for (const permissions of [config.permission!, config.agent!.build!.permission!, config.agent!.custom!.permission!]) {
      expect(decision(permissions, 'bash', 'git push --force origin probe')).toBe('deny')
      expect(decision(permissions, 'bash', 'rm -rf ..')).toBe('deny')
      expect(decision(permissions, 'plugin_huly_huly_delete_issue')).toBe('deny')
      expect(decision(permissions, 'huly_delete_issue')).toBe('deny')
      expect(decision(permissions, 'bash', 'git push origin probe')).toBe('allow')
      expect(decision(permissions, 'plugin_huly_huly_update_issue')).toBe('allow')
    }
  })

  it('preserves unrelated denies and does not turn an inherited permission into an allow', async () => {
    const config: Config = { permission: { edit: 'deny' }, agent: { build: { permission: { bash: { 'npm *': 'deny' } } }, general: {} } }
    await apply(config)
    expect(decision(config.permission!, 'edit')).toBe('deny')
    expect(decision(config.agent!.build!.permission!, 'bash', 'npm publish')).toBe('deny')
    expect(decision(config.agent!.general!.permission!, 'edit')).toBe('ask')
    expect(decision(config.agent!.general!.permission!, 'bash', 'git push --force origin probe')).toBe('deny')
  })

  it('adds only custom denies when the default groups are disabled', async () => {
    const config: Config = { agent: { build: { permission: 'allow' } } }
    await apply(config, { ...DEFAULT_PROTECTION, disabled: [...PROTECTION_GROUPS], opencode: ['echo BLOCK_*'] })
    const permission = config.agent!.build!.permission!
    expect(decision(permission, 'bash', 'echo BLOCK_ONE')).toBe('deny')
    expect(decision(permission, 'bash', 'git push --force origin probe')).toBe('allow')
    expect(decision(permission, 'plugin_huly_huly_delete_issue')).toBe('allow')
  })
})
