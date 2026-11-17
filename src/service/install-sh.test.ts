import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noServiceManagerCode } from '../cli-args.js'

/** `service/install.sh` of an npm install on a stubbed Linux: only the tools it calls are on PATH. */
describe.skipIf(process.platform === 'win32')('install.sh on Linux', () => {
  let dir: string
  let bin: string
  let unit: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-install-sh-'))
    mkdirSync(join(dir, 'package', 'service'), { recursive: true })
    copyFileSync(join(import.meta.dirname, '..', '..', 'service', 'install.sh'), join(dir, 'package', 'service', 'install.sh'))
    bin = join(dir, 'bin')
    mkdirSync(bin)
    for (const tool of ['dirname', 'id', 'grep', 'sed', 'printenv', 'mkdir', 'cat']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
      symlinkSync(found, join(bin, tool))
    }
    stub('uname', 'echo Linux')
    node('24')
    unit = join(dir, 'home', '.config', 'systemd', 'user', 'even-keel.service')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function stub(name: string, body: string): void {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }

  /** A node that answers the major version check with `major` and does nothing else. */
  function node(major: string): void {
    stub('node', `case "$1" in -p) echo ${major} ;; --version) echo v${major || 0}.0.0 ;; esac`)
  }

  function install() {
    const env = { PATH: bin, HOME: join(dir, 'home'), XDG_DATA_HOME: join(dir, 'data') }
    return spawnSync('/bin/sh', [join(dir, 'package', 'service', 'install.sh')], { encoding: 'utf8', env })
  }

  it('installs the unit where systemctl --user answers', () => {
    stub('systemctl', 'exit 0')
    const result = install()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(unit)).toBe(true)
  })

  it.each(['22', ''])('refuses a node whose major version is %j', (major) => {
    stub('systemctl', 'exit 0')
    node(major)
    const result = install()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('needs Node.js 24 or newer')
    expect(result.stderr).not.toContain('Illegal number')
    expect(existsSync(unit)).toBe(false)
  })

  it('writes no unit and says how to run it without systemctl', () => {
    const result = install()
    expect(result.status).toBe(noServiceManagerCode)
    expect(result.stderr).toContain('not installed as a service')
    expect(result.stderr).toContain('even-keel in a terminal')
    expect(result.stderr).not.toContain('not found')
    expect(existsSync(unit)).toBe(false)
  })

  it('writes no unit when systemctl has no user bus', () => {
    stub('systemctl', 'echo "Failed to connect to bus: No medium found" >&2; exit 1')
    const result = install()
    expect(result.status).toBe(noServiceManagerCode)
    expect(result.stderr).toContain('not installed as a service')
    expect(result.stderr).not.toContain('Failed to connect to bus')
    expect(existsSync(unit)).toBe(false)
  })
})
