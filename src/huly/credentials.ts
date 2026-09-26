export interface HulyCredentials {
  url: string
  workspace: string
  email: string
  password: string
}

const VARIABLES = ['HULY_URL', 'HULY_WORKSPACE', 'HULY_EMAIL', 'HULY_PASSWORD'] as const

export function readHulyCredentials(env: Record<string, string | undefined>): HulyCredentials | undefined {
  const missing = VARIABLES.filter((name) => !env[name])
  if (missing.length === VARIABLES.length) return undefined
  if (missing.length > 0) throw new Error(`huly: set ${missing.join(', ')} or none of the HULY_* variables`)
  return {
    url: env.HULY_URL!,
    workspace: env.HULY_WORKSPACE!,
    email: env.HULY_EMAIL!,
    password: env.HULY_PASSWORD!,
  }
}
