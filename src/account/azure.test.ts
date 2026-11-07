import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { azureDir, readAzure } from './azure.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'azure-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('azureDir', () => {
  it('is AZURE_CONFIG_DIR, else ~/.azure', () => {
    expect(azureDir({ AZURE_CONFIG_DIR: '/custom' })).toBe('/custom')
    expect(azureDir({})).toMatch(/[\\/]\.azure$/)
  })
})

describe('readAzure', () => {
  it('tells no sign-in without a profile or with one listing no subscription', () => {
    expect(readAzure({ AZURE_CONFIG_DIR: dir })).toMatchObject({ profileFile: join(dir, 'azureProfile.json'), signedIn: false, environment: false })
    writeFileSync(join(dir, 'azureProfile.json'), JSON.stringify({ installationId: 'fake', subscriptions: [] }))
    expect(readAzure({ AZURE_CONFIG_DIR: dir }).signedIn).toBe(false)
  })

  it('tells a sign-in from a profile written with a byte order mark', () => {
    writeFileSync(join(dir, 'azureProfile.json'), '﻿' + JSON.stringify({ subscriptions: [{ id: '00000000-0000-0000-0000-000000000000', user: { name: 'john@example.com' } }] }))
    expect(readAzure({ AZURE_CONFIG_DIR: dir }).signedIn).toBe(true)
  })

  it('tells a service principal of the environment only with its id, tenant and a secret', () => {
    const principal = { AZURE_CONFIG_DIR: dir, AZURE_CLIENT_ID: 'fake-id', AZURE_TENANT_ID: 'fake-tenant' }
    expect(readAzure(principal).environment).toBe(false)
    expect(readAzure({ ...principal, AZURE_CLIENT_SECRET: 'fake-secret' }).environment).toBe(true)
    expect(readAzure({ ...principal, AZURE_FEDERATED_TOKEN_FILE: '/var/run/token' }).environment).toBe(true)
  })
})
