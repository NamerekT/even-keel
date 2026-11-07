import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { currentUser } from './aws.js'
import type { GcloudCredentials } from './cloud.js'

const ADC_FILE = 'application_default_credentials.json'

/** The gcloud configuration folder where Google's auth library looks for ADC: `CLOUDSDK_CONFIG` moves it. */
export function gcloudDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (env.CLOUDSDK_CONFIG !== undefined && env.CLOUDSDK_CONFIG !== '') return env.CLOUDSDK_CONFIG
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'gcloud')
  return join(homedir(), '.config', 'gcloud')
}

/** The Google Cloud credentials of the user Even Keel runs as, for the Vertex form (BTN-823). */
export function readGcloud(env: NodeJS.ProcessEnv): GcloudCredentials {
  const dir = gcloudDir(env)
  const adcFile = join(dir, ADC_FILE)
  const adc = readJson(adcFile)
  const projects = new Set(configProjects(dir))
  if (typeof adc?.quota_project_id === 'string' && adc.quota_project_id !== '') projects.add(adc.quota_project_id)
  return {
    user: currentUser(),
    home: homedir(),
    adcFile,
    adcType: typeof adc?.type === 'string' ? adc.type : null,
    environmentFile: env.GOOGLE_APPLICATION_CREDENTIALS || null,
    projects: [...projects],
  }
}

/**
 * Whether the credentials file in effect holds a user's sign-in, which an organization's session policy may expire:
 * the account's key file, else the service's `GOOGLE_APPLICATION_CREDENTIALS`, else the ADC file. A service account
 * or a Workload Identity Federation config is not, nor a missing file.
 */
export function userCredentials(env: NodeJS.ProcessEnv, keyFile: string | null): boolean {
  const file = keyFile ?? (env.GOOGLE_APPLICATION_CREDENTIALS || join(gcloudDir(env), ADC_FILE))
  return readJson(file)?.type === 'authorized_user'
}

/** The `project` of every gcloud configuration (`configurations/config_<name>`), as the CLI's own wizard offers them. */
function configProjects(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(join(dir, 'configurations')).filter((name) => name.startsWith('config_')).sort()
  } catch {
    return []
  }
  const projects: string[] = []
  for (const name of names) {
    let text: string
    try {
      text = readFileSync(join(dir, 'configurations', name), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/^project\s*=\s*(\S+)/gm)) projects.push(match[1]!)
  }
  return projects
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
