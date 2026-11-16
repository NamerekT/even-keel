import { expect, it, vi } from 'vitest'
import { emptyBrief, BriefCopy } from './brief.js'
import { MachineConfig } from './config.js'

it('keeps a local CLI fallback through a restart and accepts a later hub choice', () => {
  const brief = new BriefCopy()
  const given = emptyBrief()
  given.config.cli.claude = 'checked'
  brief.take(given)
  const save = vi.fn()
  const select = vi.fn()
  const config = new MachineConfig(brief, {}, save, select)
  config.fallBackCli('claude')
  expect(config.current.cli.claude).toBe('system')
  expect(given.config.cli.claude).toBe('checked')
  const reopened = new MachineConfig(brief, save.mock.lastCall![0], save, select)
  expect(reopened.current.cli.claude).toBe('system')
  brief.take({ ...given, config: { ...given.config, cli: { claude: 'system' } } })
  expect(reopened.current.cli.claude).toBe('system')
  brief.take(given)
  expect(reopened.current.cli.claude).toBe('checked')
  expect(select).toHaveBeenCalledWith({ kind: 'cli', provider: 'claude', value: 'system' })
})

it('does not fall back when the execution needs the checked CLI', () => {
  const brief = new BriefCopy()
  const given = emptyBrief()
  given.config.cli.claude = 'checked'
  given.config.execution.claude = 'sdk'
  brief.take(given)
  const select = vi.fn()
  const config = new MachineConfig(brief, {}, vi.fn(), select)
  config.fallBackCli('claude')
  expect(config.current.cli.claude).toBe('checked')
  expect(select).not.toHaveBeenCalled()
})
