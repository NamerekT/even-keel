import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { CliInstaller, installerLine, type InstallerChild, type CliInstallerOptions } from './cli-installer.js'

class FakeChild extends EventEmitter implements InstallerChild {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
}

function installer(over: Partial<CliInstallerOptions> = {}) {
  const children: FakeChild[] = []
  const ran: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }> = []
  const ended = vi.fn(async () => {})
  const changed = vi.fn()
  const options: CliInstallerOptions = {
    platform: 'linux',
    installable: () => ['claude', 'codex'],
    title: (agent) => agent,
    env: () => ({ PATH: '/usr/bin', HOME: '/home/john' }),
    execPath: '/opt/node/bin/node',
    spawn: (file, args, options) => {
      ran.push({ file, args, env: options.env })
      const child = new FakeChild()
      children.push(child)
      return child
    },
    timeoutMs: 60_000,
    onChange: changed,
    onEnd: ended,
    log: () => {},
    now: () => new Date('2026-11-23T10:00:00Z'),
    ...over,
  }
  return { cli: new CliInstaller(options), children, ran, ended, changed }
}

describe('the command an install runs', () => {
  it('goes through the shell of the platform, PowerShell on Windows', () => {
    expect(installerLine('curl -fsSL https://claude.ai/install.sh | bash', 'linux')).toEqual({ file: '/bin/sh', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] })
    expect(installerLine('irm https://claude.ai/install.ps1 | iex', 'win32')).toEqual({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'],
    })
  })
})

describe('CliInstaller', () => {
  it('names the command of each agent it can install, and none of the others', () => {
    const { cli } = installer({ installable: () => ['claude', 'codex', 'unknown'] })
    expect(cli.commands()).toEqual({ claude: 'curl -fsSL https://claude.ai/install.sh | bash', codex: 'npm install -g @openai/codex' })
  })

  it('runs the installer with the folder of its own node first on the PATH, so npm finds it', () => {
    const { cli, ran, changed } = installer()
    cli.start('codex')
    expect(ran).toEqual([{ file: '/bin/sh', args: ['-c', 'npm install -g @openai/codex'], env: { PATH: '/opt/node/bin:/usr/bin', HOME: '/home/john' } }])
    expect(cli.view()).toEqual({ agent: 'codex', command: 'npm install -g @openai/codex', startedAt: '2026-11-23T10:00:00.000Z', output: '', state: 'running' })
    expect(changed).toHaveBeenCalled()
  })

  it('keeps the output without terminal escapes, ends done on exit 0 and looks for the CLIs again', async () => {
    const { cli, children, ended } = installer()
    cli.start('claude')
    children[0]!.stdout.emit('data', Buffer.from('\u001b[32mInstalling\u001b[0m Claude Code\n'))
    children[0]!.stderr.emit('data', Buffer.from('a warning\n'))
    expect(cli.view()?.output).toBe('Installing Claude Code\na warning\n')
    children[0]!.emit('close', 0)
    await vi.waitFor(() => expect(ended).toHaveBeenCalled())
    expect(cli.view()?.state).toBe('done')
  })

  it('ends failed on another exit, and on a start that never happened', async () => {
    const { cli, children } = installer()
    cli.start('claude')
    children[0]!.emit('close', 1)
    expect(cli.view()?.state).toBe('failed')
    cli.start('codex')
    children[1]!.emit('error', new Error('spawn /bin/sh ENOENT'))
    expect(cli.view()).toMatchObject({ agent: 'codex', state: 'failed', output: 'spawn /bin/sh ENOENT\n' })
  })

  it('keeps only the tail of a long output', () => {
    const { cli, children } = installer()
    cli.start('claude')
    children[0]!.stdout.emit('data', Buffer.from('x'.repeat(100_000)))
    children[0]!.stdout.emit('data', Buffer.from('the end'))
    expect(cli.view()!.output.length).toBeLessThanOrEqual(20_000)
    expect(cli.view()!.output.endsWith('the end')).toBe(true)
  })

  it('stops an installer that runs past its time and ends it failed', () => {
    vi.useFakeTimers()
    try {
      const { cli, children } = installer({ timeoutMs: 1_000 })
      cli.start('claude')
      vi.advanceTimersByTime(1_000)
      expect(children[0]!.killed).toBe(true)
      children[0]!.emit('close', null)
      expect(cli.view()?.state).toBe('failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a second install while one runs, and an agent it cannot install', () => {
    const { cli } = installer()
    cli.start('claude')
    expect(() => cli.start('codex')).toThrow(NoticeError)
    expect(() => cli.start('codex')).toThrow(/being installed/)
    const other = installer({ installable: () => ['claude'] }).cli
    expect(() => other.start('codex')).toThrow(/cannot be installed here/)
  })
})
