import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { awsFiles, awsProfiles, shortLivedProfile } from './aws.js'

const config = `
# a comment
[default]
region = us-east-1

[profile work]
region = eu-central-1
output = json

[profile sso-dev]
sso_session = corp
sso_account_id = 000000000000

[sso-session corp]
sso_start_url = https://example.awsapps.com/start
sso_registration_scopes =
  sso:account:access

[profile login]
login_session = arn:aws:iam::000000000000:user/john
`

const credentials = `
[default]
aws_access_key_id = AKIAFAKE
aws_secret_access_key = fake

[temp]
aws_access_key_id = ASIAFAKE
aws_secret_access_key = fake
aws_session_token = fake
`

describe('awsProfiles', () => {
  it('lists the profiles of both files, default first, without the sso-session sections', () => {
    expect(awsProfiles(config, credentials)).toEqual([
      { name: 'default', region: 'us-east-1', shortLived: false },
      { name: 'login', region: null, shortLived: true },
      { name: 'sso-dev', region: null, shortLived: true },
      { name: 'temp', region: null, shortLived: true },
      { name: 'work', region: 'eu-central-1', shortLived: false },
    ])
  })

  it('is empty without the files', () => {
    expect(awsProfiles('', '')).toEqual([])
  })
})

describe('shortLivedProfile', () => {
  it('reads the files the AWS variables point to and is false for a profile not found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-aws-'))
    try {
      writeFileSync(join(dir, 'config'), config)
      writeFileSync(join(dir, 'credentials'), credentials)
      const env = { AWS_CONFIG_FILE: join(dir, 'config'), AWS_SHARED_CREDENTIALS_FILE: join(dir, 'credentials') }
      expect(awsFiles(env)).toEqual({ config: join(dir, 'config'), credentials: join(dir, 'credentials') })
      expect(shortLivedProfile(env, 'sso-dev')).toBe(true)
      expect(shortLivedProfile(env, 'work')).toBe(false)
      expect(shortLivedProfile(env, 'missing')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
