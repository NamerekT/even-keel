import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// A child process: the global dispatcher is process-wide and a test must not change it for the other files.
function protocolOfFetch(setup: string): string {
  const cert = new URL('./link/cert.ts', import.meta.url).href
  const script = `
    import { createSecureServer } from 'node:http2'
    import { createCertificate } from ${JSON.stringify(cert)}
    ${setup}
    const { key, cert } = createCertificate()
    const server = createSecureServer({ key, cert, allowHTTP1: true }, (_request, response) => response.end('ok'))
    let protocol = 'none'
    server.on('secureConnection', (socket) => { protocol = socket.alpnProtocol })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const response = await fetch('https://127.0.0.1:' + server.address().port + '/')
    await response.text()
    console.log('protocol=' + protocol)
    process.exit(0)
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_NO_WARNINGS: '1' },
  })
  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe('')
  return /protocol=(\S+)/.exec(result.stdout)?.[1] ?? 'none'
}

describe("the service's fetch", () => {
  it('goes over HTTP/1.1 even where the server offers HTTP/2', () => {
    const module = new URL('./fetch-dispatcher.ts', import.meta.url).href
    expect(protocolOfFetch(`import { fetchOverHttp1 } from ${JSON.stringify(module)}; fetchOverHttp1()`)).toBe('http/1.1')
  })

  it("would take HTTP/2 without it, which is what Node's own fetch does", () => {
    expect(protocolOfFetch('')).toBe('h2')
  })
})
