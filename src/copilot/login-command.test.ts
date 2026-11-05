import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loginCommand, TOKEN_KEYS } from './home.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const shells = process.platform === 'win32'
  ? [{ bin: 'cmd.exe', platform: 'win32' as const }, { bin: 'C:/Program Files/Git/bin/sh.exe', platform: 'linux' as const }]
  : [{ bin: '/bin/sh', platform: process.platform }]

for (const shell of shells) {
  it.each([[0, true], [7, true], [0, false], [7, false]] as const)(`${shell.bin}: preserves the parent environment after exit %i (tokens present: %s) and a repeat`, (exit, present) => {
    const dir = mkdtempSync(join(tmpdir(), "copilot command & it's-"))
    dirs.push(dir)
    const home = join(dir, 'account & folder')
    const script = `const keys = ${JSON.stringify([...TOKEN_KEYS, 'COPILOT_HOME'])}; console.log('PROBE:' + JSON.stringify(Object.fromEntries(keys.map(key => [key, process.env[key] ?? null])))); process.exit(${exit});`
    writeFileSync(join(dir, 'login'), script)
    writeFileSync(join(dir, 'parent'), script.replace(`process.exit(${exit})`, 'process.exit(0)'))
    let bin = process.execPath
    if (shell.platform === 'win32') {
      bin = join(dir, "fake & it's copilot.cmd")
      writeFileSync(bin, `@"${process.execPath}" login\r\n@exit /b %errorlevel%\r\n`)
    } else {
      bin = join(dir, "fake & it's copilot")
      writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath.replaceAll('\\', '/').replaceAll("'", "'\\''")}' '${join(dir, 'login').replaceAll('\\', '/').replaceAll("'", "'\\''")}'\n`)
      chmodSync(bin, 0o755)
    }
    const command = loginCommand(bin, home, shell.platform)
    const parent = `"${process.execPath.replaceAll('\\', '/')}" parent`
    const input = `${command}\n${parent}\n${command}\n${parent}\nexit\n`
    const env: NodeJS.ProcessEnv = { ...process.env, COPILOT_HOME: 'original-home', COPILOT_GITHUB_TOKEN: 'fake-first', GH_TOKEN: 'fake-second', GITHUB_TOKEN: 'fake-third' }
    if (!present) for (const key of TOKEN_KEYS) delete env[key]
    const result = spawnSync(shell.bin, shell.platform === 'win32' ? ['/d', '/v:off', '/q'] : [], {
      cwd: dir, env, input, encoding: 'utf8', timeout: 10_000, windowsHide: true,
    })
    expect(result.error).toBeUndefined()
    const probes = [...result.stdout.matchAll(/PROBE:(\{[^\r\n]+\})/g)].map((match) => JSON.parse(match[1]!))
    const child = { COPILOT_HOME: home, COPILOT_GITHUB_TOKEN: null, GH_TOKEN: null, GITHUB_TOKEN: null }
    const original = Object.fromEntries([...TOKEN_KEYS, 'COPILOT_HOME'].map((key) => [key, env[key] ?? null]))
    expect(probes, result.stderr).toEqual([child, original, child, original])
  })
}
