export interface HulyCredentials {
  url: string
  workspace: string
  /** A token signs in by itself; without one, the e-mail and the password. */
  token: string | null
  email: string | null
  password: string | null
}

export const HOST_VARIABLES = ['HULY_URL', 'HULY_WORKSPACE'] as const
export const VARIABLES = [...HOST_VARIABLES, 'HULY_TOKEN', 'HULY_EMAIL', 'HULY_PASSWORD'] as const
/** A profile fills one of them: the e-mail and the password, or the token. The dialog opens on the first: released Huly has no API tokens page. */
export const ALTERNATIVES = [['HULY_EMAIL', 'HULY_PASSWORD'], ['HULY_TOKEN']] as const

export function readHulyCredentials(env: Readonly<Record<string, string | undefined>>): HulyCredentials | undefined {
  if (VARIABLES.every((name) => !env[name])) return undefined
  const missing: string[] = HOST_VARIABLES.filter((name) => !env[name])
  if (!env.HULY_TOKEN) missing.push(...ALTERNATIVES[0].filter((name) => !env[name]))
  if (missing.length > 0) throw new Error(`set ${missing.join(', ')}${env.HULY_TOKEN ? '' : ' (or HULY_TOKEN)'}, or none of the HULY_* variables`)
  return {
    url: env.HULY_URL!,
    workspace: env.HULY_WORKSPACE!,
    token: env.HULY_TOKEN || null,
    email: env.HULY_TOKEN ? null : env.HULY_EMAIL!,
    password: env.HULY_TOKEN ? null : env.HULY_PASSWORD!,
  }
}

/** What `@hcengineering/api-client` signs in with: the token when there is one. */
export function authOf({ workspace, token, email, password }: HulyCredentials): Record<string, string> {
  return token !== null ? { token, workspace } : { email: email!, password: password!, workspace }
}

export function issueUrlBase({ url, workspace }: Pick<HulyCredentials, 'url' | 'workspace'>): string {
  return `${url.replace(/\/+$/, '')}/workbench/${encodeURIComponent(workspace)}/tracker/`
}
