import { runWithInput } from '../agent/oneturn.js'

/** Only a source confirmed by the CLI may supply a machine allowance; never substitute another account's token. */
export async function machineToken(bin: string, env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<string | null> {
  const options = { cwd, env, timeoutMs }
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'auth.getStatus', params: {} })
  try {
    const output = await runWithInput(bin, ['--headless', '--stdio', '--no-auto-update'],
      `Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`, options)
    const status = statusOf(output)
    if (status?.isAuthenticated !== true || status.authType !== 'gh-cli' ||
      !['github.com', 'https://github.com'].includes(String(status.host)) ||
      typeof status.login !== 'string' || !/^[a-z\d][a-z\d-]{0,38}$/i.test(status.login)) return null
    const token = (await runWithInput('gh', ['auth', 'token', '--hostname', 'github.com', '--user', status.login], '', options)).trim()
    return /^(?:gho_|ghu_|github_pat_)[a-z\d_]+$/i.test(token) ? token : null
  } catch {
    // CLI failures may contain credentials; neither the output nor the exception leaves this call.
    return null
  }
}

function statusOf(output: string): Record<string, unknown> | null {
  let frames = Buffer.from(output)
  while (frames.length > 0) {
    const end = frames.indexOf('\r\n\r\n')
    if (end < 0) return null
    const header = frames.subarray(0, end).toString('ascii')
    const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header)
    const size = match === null ? NaN : Number(match[1])
    const start = end + 4
    if (!Number.isSafeInteger(size) || size < 1 || size > 65_536 || frames.length < start + size) return null
    const reply = JSON.parse(frames.subarray(start, start + size).toString('utf8')) as Record<string, unknown>
    if (reply.jsonrpc === '2.0' && reply.id === 1) {
      const result = reply.result
      return typeof result === 'object' && result !== null && !Array.isArray(result) ? result as Record<string, unknown> : null
    }
    frames = frames.subarray(start + size)
  }
  return null
}
