import type { Notice } from '../../../src/notice/notice.js'

type Untrusted = Extract<Notice, { code: 'claude.untrusted' }>['params']

/** A CLI trust refusal, including one wrapped in a chain error. */
export function untrustedOf(notice: Notice | null | undefined): Untrusted | null {
  if (notice == null) return null
  if (notice.code === 'claude.untrusted') return notice.params
  for (const item of notice.items ?? []) {
    const found = untrustedOf(item)
    if (found !== null) return found
  }
  return untrustedOf(notice.cause)
}

const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
const psQuoted = (text: string) => `'${text.replace(/'/g, "''")}'`
const winQuoted = (text: string) => `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`

/** Commands from the refused invocation; old saved notices retain the original PATH commands. */
export function trustCommandsOf(place: Untrusted): { own: string; as: string | null; shell?: 'powershell' } {
  const { folder, platform, user } = place
  const saved = place.recovery
  if (saved && typeof saved.binary === 'string' && saved.binary !== '' && (saved.configDir === null || (typeof saved.configDir === 'string' && saved.configDir !== ''))) {
    const { binary, configDir } = saved
    if (platform === 'win32') {
      const script = `Set-Location -LiteralPath ${psQuoted(folder)}; if ($?) { ${configDir === null ? 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue' : `$env:CLAUDE_CONFIG_DIR = ${psQuoted(configDir)}`}; & ${psQuoted(binary)} }`
      const target = `powershell -NoExit -NoProfile -Command ${winQuoted(script)}`
      const args = `${winQuoted(`/user:${user}`)} ${winQuoted(target)}`
      const as = `Start-Process runas.exe -NoNewWindow -Wait -ArgumentList ${psQuoted(args)}`
      return { own: script, as: (place.service ?? true) ? as : null, shell: 'powershell' }
    }
    const env = configDir === null ? 'env -u CLAUDE_CONFIG_DIR' : `env CLAUDE_CONFIG_DIR=${quoted(configDir)}`
    return {
      own: `cd ${quoted(folder)} && ${env} ${quoted(binary)}`,
      as: (place.service ?? true) ? `cd ${quoted(folder)} && sudo -u ${quoted(user)} -H ${env} ${quoted(binary)}` : null,
    }
  }
  const own = platform === 'win32' ? `pushd "${folder}" && claude` : `cd ${quoted(folder)} && claude`
  const service = place.service ?? true
  const as = !service ? null : platform === 'win32'
    ? `runas /user:${user} "cmd /k cd /d ${folder} && claude"`
    : `cd ${quoted(folder)} && sudo -u ${quoted(user)} -H claude`
  return { own, as }
}
