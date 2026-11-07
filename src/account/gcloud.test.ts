import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gcloudDir, readGcloud, userCredentials } from './gcloud.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gcloud-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function adc(content: object) {
  writeFileSync(join(dir, 'application_default_credentials.json'), JSON.stringify(content))
}

describe('gcloudDir', () => {
  it('is CLOUDSDK_CONFIG, else APPDATA on Windows and ~/.config elsewhere', () => {
    expect(gcloudDir({ CLOUDSDK_CONFIG: '/custom' }, 'linux')).toBe('/custom')
    expect(gcloudDir({ APPDATA: 'C:\\Users\\john\\AppData\\Roaming' }, 'win32')).toBe(join('C:\\Users\\john\\AppData\\Roaming', 'gcloud'))
    expect(gcloudDir({}, 'linux')).toMatch(/[\\/]\.config[\\/]gcloud$/)
  })
})

describe('readGcloud', () => {
  it('tells no ADC file and no project', () => {
    const read = readGcloud({ CLOUDSDK_CONFIG: dir })
    expect(read).toMatchObject({ adcFile: join(dir, 'application_default_credentials.json'), adcType: null, environmentFile: null, projects: [] })
  })

  it('reads the ADC type and offers the projects of the configurations and the quota project', () => {
    adc({ type: 'authorized_user', client_id: 'fake', quota_project_id: 'quota-project' })
    mkdirSync(join(dir, 'configurations'))
    writeFileSync(join(dir, 'configurations', 'config_default'), '[core]\naccount = john@example.com\nproject = main-project\n')
    writeFileSync(join(dir, 'configurations', 'config_other'), '[core]\nproject = main-project\n')
    writeFileSync(join(dir, 'configurations', 'notes.txt'), 'project = not-a-config\n')
    const read = readGcloud({ CLOUDSDK_CONFIG: dir, GOOGLE_APPLICATION_CREDENTIALS: '/keys/sa.json' })
    expect(read).toMatchObject({ adcType: 'authorized_user', environmentFile: '/keys/sa.json', projects: ['main-project', 'quota-project'] })
  })
})

describe('userCredentials', () => {
  it('is true for a user sign-in in the file in effect: the key file, the service variable, else ADC', () => {
    adc({ type: 'authorized_user' })
    const key = join(dir, 'sa.json')
    writeFileSync(key, JSON.stringify({ type: 'service_account', client_email: 'sa@example.com' }))
    expect(userCredentials({ CLOUDSDK_CONFIG: dir }, null)).toBe(true)
    expect(userCredentials({ CLOUDSDK_CONFIG: dir }, key)).toBe(false)
    expect(userCredentials({ CLOUDSDK_CONFIG: dir, GOOGLE_APPLICATION_CREDENTIALS: key }, null)).toBe(false)
    expect(userCredentials({ CLOUDSDK_CONFIG: join(dir, 'missing') }, null)).toBe(false)
  })
})
