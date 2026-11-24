import { spawn } from 'node:child_process'
import { basename, dirname } from 'node:path'
import type { GitAnswer, GitRequest } from '../../link/protocol.js'

const TIMEOUT_MS = 5 * 60_000
const MAX_ANSWER_BYTES = 64 * 1024 * 1024

/** A plain answer of the relay or the hub that is not git's own: a refusal, a missing repository, a failure. */
export function plainAnswer(status: number, text: string): GitAnswer {
  return { status, contentType: 'text/plain', body: Buffer.from(`${text}\n`).toString('base64') }
}

/** The CGI answer of `git http-backend`: its header lines, a blank line, then the body as it is. */
export function parseCgi(output: Buffer): GitAnswer {
  let end = output.indexOf('\r\n\r\n')
  let gap = 4
  if (end < 0) {
    end = output.indexOf('\n\n')
    gap = 2
  }
  if (end < 0) return plainAnswer(502, 'git http-backend gave no headers')
  let status = 200
  let contentType = 'application/octet-stream'
  for (const line of output.subarray(0, end).toString('latin1').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (name === 'status') status = Number.parseInt(value, 10) || 500
    else if (name === 'content-type') contentType = value
  }
  return { status, contentType, body: output.subarray(end + gap).toString('base64') }
}

/**
 * One request of git's smart HTTP protocol answered by `git http-backend` over a bare repository (BTN-1648): what the
 * hub does with a machine's `/link/git`. `REMOTE_USER` names the machine, so the backend takes pushes, which it refuses
 * from an anonymous caller; the right to the repository was checked before.
 */
export function gitBackend(repository: string, request: GitRequest, user: string): Promise<GitAnswer> {
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`
  if (path.split('/').includes('..')) return Promise.resolve(plainAnswer(400, 'not a path of the repository'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: dirname(repository),
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: `/${basename(repository)}${path}`,
    REQUEST_METHOD: request.method,
    QUERY_STRING: request.query,
    REMOTE_USER: user,
    REMOTE_ADDR: '127.0.0.1',
    CONTENT_TYPE: request.contentType ?? '',
    ...(request.contentEncoding !== undefined && { HTTP_CONTENT_ENCODING: request.contentEncoding }),
    ...(request.gitProtocol !== undefined && { GIT_PROTOCOL: request.gitProtocol }),
  }
  const body = request.body === undefined ? Buffer.alloc(0) : Buffer.from(request.body, 'base64')
  env.CONTENT_LENGTH = String(body.length)
  return new Promise((resolve) => {
    const child = spawn('git', ['http-backend'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let size = 0
    let errors = ''
    let settled = false
    const done = (answer: GitAnswer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(answer)
    }
    const timer = setTimeout(() => {
      child.kill()
      done(plainAnswer(504, 'git http-backend took too long'))
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_ANSWER_BYTES) {
        child.kill()
        done(plainAnswer(413, 'the answer of git http-backend is too large'))
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
    child.on('error', (error) => done(plainAnswer(500, `git http-backend did not start: ${error.message}`)))
    child.on('close', (code) => {
      const output = Buffer.concat(chunks)
      if (output.length === 0 && code !== 0) done(plainAnswer(500, `git http-backend failed: ${errors.trim() || `exit ${code}`}`))
      else done(parseCgi(output))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(body)
  })
}
