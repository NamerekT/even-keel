import { describe, expect, it } from 'vitest'
import { findSecrets } from './secrets.js'

// Fake values built at run time, so that no scanner (ours or GitHub's) takes this file itself for a leak.
const repeat = (part: string, times: number) => part.repeat(times)

describe('findSecrets', () => {
  it.each([
    ['private key', `-----BEGIN OPENSSH ${'PRIVATE'} KEY-----`],
    ['AWS access key', `key AKIA${repeat('ABCD2345', 2)}`],
    ['GitHub token', `token: ghp_${repeat('a1B2c3D4e5', 4)}`],
    ['Anthropic key', `sk-ant-api03-${repeat('Ab3_', 8)}`],
    ['OpenAI key', `OPENAI=sk-proj-${repeat('Zx9-', 10)}`],
    ['Slack token', `xoxb-${repeat('1234-', 3)}abc`],
    ['JSON web token', `eyJ${repeat('hbGciOiJ', 2)}.eyJ${repeat('zdWIiOiI', 2)}.${repeat('sig_', 4)}`],
    ['password in a URL', 'postgres://john:Qw3rty-9zz@db.example.com/app'],
    ['assigned secret', 'HULY_PASSWORD="Xk29vLq0Zp7Rt4Mn8Bw1"'],
  ])('finds a %s', (kind, line) => {
    expect(findSecrets(`# Note\n\n${line}\n`)).toEqual([{ kind, line: 3 }])
  })

  it.each([
    'EVEN_KEEL_TOKEN is empty in a chain session',
    'token: <your token here>',
    'postgres://john:password@db.example.com/app',
    'postgres://john:${PASSWORD}@db.example.com/app',
    'secret = src/account/longToken.ts',
    'apiKeyHelper: aaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    'see https://github.com/example/repo/blob/main/docs/sessions.md',
  ])('lets plain text through: %s', (line) => {
    expect(findSecrets(line)).toEqual([])
  })
})
