import type { Notice } from '../../../src/notice/notice.js'

type Untrusted = Extract<Notice, { code: 'claude.untrusted' }>['params']

/** A command of a trust pause: `as` names the user it runs as when the pause shows two (`trustCommandsOf`). */
export type TrustCommand = { command: string; shell: 'cmd' | 'powershell' | 'terminal'; as?: string }

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

/** `runas` of the script the service wrote (EKR-87), typed into cmd: the only quotes inside are around a path with spaces. */
function runasScript(user: string, script: string): string {
  const who = /[\s&^%!()]/.test(user) ? `"/user:${user}"` : `/user:${user}`
  const file = /\s/.test(script) ? `\\"${script}\\"` : script
  return `runas ${who} "powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File ${file}"`
}

/** The refused invocation run by hand: as the current user and, through runas/sudo, as the service's. */
function bothOf(place: Untrusted): { own: TrustCommand; as: TrustCommand } {
  const { folder, platform, user } = place
  const saved = place.recovery
  if (saved && typeof saved.binary === 'string' && saved.binary !== '' && (saved.configDir === null || (typeof saved.configDir === 'string' && saved.configDir !== ''))) {
    const { binary, configDir } = saved
    if (platform === 'win32') {
      const script = `Set-Location -LiteralPath ${psQuoted(folder)}; if ($?) { ${configDir === null ? 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue' : `$env:CLAUDE_CONFIG_DIR = ${psQuoted(configDir)}`}; & ${psQuoted(binary)} }`
      const own: TrustCommand = { command: script, shell: 'powershell' }
      if (typeof place.script === 'string' && place.script !== '') return { own, as: { command: runasScript(user, place.script), shell: 'cmd', as: user } }
      // A pause from before the script (EKR-86): the line quoted for both levels of process arguments.
      const target = `powershell -NoExit -NoProfile -Command ${winQuoted(script)}`
      const args = `${winQuoted(`/user:${user}`)} ${winQuoted(target)}`
      return { own, as: { command: `Start-Process runas.exe -NoNewWindow -Wait -ArgumentList ${psQuoted(args)}`, shell: 'powershell', as: user } }
    }
    const env = configDir === null ? 'env -u CLAUDE_CONFIG_DIR' : `env CLAUDE_CONFIG_DIR=${quoted(configDir)}`
    return {
      own: { command: `cd ${quoted(folder)} && ${env} ${quoted(binary)}`, shell: 'terminal' },
      as: { command: `cd ${quoted(folder)} && sudo -u ${quoted(user)} -H ${env} ${quoted(binary)}`, shell: 'terminal', as: user },
    }
  }
  if (platform === 'win32') return {
    own: { command: `pushd "${folder}" && claude`, shell: 'cmd' },
    as: { command: `runas /user:${user} "cmd /k cd /d ${folder} && claude"`, shell: 'cmd', as: user },
  }
  return {
    own: { command: `cd ${quoted(folder)} && claude`, shell: 'terminal' },
    as: { command: `cd ${quoted(folder)} && sudo -u ${quoted(user)} -H claude`, shell: 'terminal', as: user },
  }
}

/**
 * The command this installation needs (EKR-87): the service user's under a system service, the current user's
 * otherwise. Only a pause saved before Even Keel told the two apart (no `service`, BTN-687) shows both.
 */
export function trustCommandsOf(place: Untrusted): TrustCommand[] {
  const { own, as } = bothOf(place)
  return place.service === true ? [as] : place.service === false ? [own] : [own, as]
}
