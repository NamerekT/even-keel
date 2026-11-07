import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { currentUser } from './aws.js'
import type { AzureCredentials } from './cloud.js'

/** The Azure CLI's folder, where `az login` leaves the profile: `AZURE_CONFIG_DIR` moves it. */
export function azureDir(env: NodeJS.ProcessEnv): string {
  if (env.AZURE_CONFIG_DIR !== undefined && env.AZURE_CONFIG_DIR !== '') return env.AZURE_CONFIG_DIR
  return join(homedir(), '.azure')
}

/**
 * The Azure sign-in of the user Even Keel runs as, for the Foundry form's Entra ID way (BTN-824). The Azure SDK's chain
 * the CLI uses tries a service principal of the environment before `az login`, so both are told.
 */
export function readAzure(env: NodeJS.ProcessEnv): AzureCredentials {
  const profileFile = join(azureDir(env), 'azureProfile.json')
  const secret = env.AZURE_CLIENT_SECRET || env.AZURE_CLIENT_CERTIFICATE_PATH || env.AZURE_FEDERATED_TOKEN_FILE
  return {
    user: currentUser(),
    home: homedir(),
    profileFile,
    signedIn: subscriptions(profileFile) > 0,
    environment: Boolean(env.AZURE_CLIENT_ID && env.AZURE_TENANT_ID && secret),
  }
}

/** The subscriptions of the profile; the Azure CLI writes it with a byte order mark on Windows. */
function subscriptions(file: string): number {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
    const list = typeof value === 'object' && value !== null ? (value as { subscriptions?: unknown }).subscriptions : undefined
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}
