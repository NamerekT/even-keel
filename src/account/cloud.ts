import { fail } from '../notice/notice.js'

/**
 * A Claude account on a cloud (BTN-822): the CLI reaches the models through the cloud's own API, paid by the cloud's
 * bill. Every cloud is one of `CLOUDS`; only the ones of `CLOUDS_READY` can be added yet (Vertex and Foundry follow).
 * Its whole connection is the `env` of the folder's `settings.json`, the way an API account holds its key.
 */
export const CLOUDS = ['bedrock', 'vertex', 'foundry'] as const
export type Cloud = (typeof CLOUDS)[number]
export const CLOUDS_READY: readonly Cloud[] = ['bedrock']

/** How a Bedrock account finds its AWS credentials. */
export const BEDROCK_WAYS = ['profile', 'apiKey', 'keys', 'environment'] as const
export type BedrockWay = (typeof BEDROCK_WAYS)[number]

export interface CloudModels {
  opus?: string
  sonnet?: string
  haiku?: string
}

export type BedrockAuth =
  | { way: 'profile'; profile: string }
  | { way: 'apiKey'; key: string }
  | { way: 'keys'; accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | { way: 'environment' }

export interface BedrockConnection {
  cloud: 'bedrock'
  /** Optional: the CLI takes `AWS_REGION`, then `AWS_DEFAULT_REGION`, the profile's region, `us-east-1`. */
  region?: string
  auth: BedrockAuth
  models?: CloudModels
  /** `ANTHROPIC_BEDROCK_REGION_PREFIX`: the inference profile prefix (`us`, `eu`, `global`) the CLI's default models get. */
  regionPrefix?: string
}

export type CloudConnection = BedrockConnection

/** What the page shows of a cloud account: never a secret. */
export interface CloudSummary {
  cloud: Cloud
  region: string | null
  way: BedrockWay
  /** The AWS profile, for the `profile` way. */
  profile?: string
  /** Pinned models by family. */
  models: CloudModels
  /** The credentials expire within hours and are renewed in a browser: a chain left alone stops (`shortLivedKey`). */
  shortLived: boolean
}

/** A profile of the AWS files the cloud form offers: only its name is kept in the account (`readAwsProfiles`). */
export interface AwsProfile {
  name: string
  region: string | null
  /** SSO, `aws login` or a session token: renewed in a browser within hours, so a chain left alone stops. */
  shortLived: boolean
}

/** The profiles of the user Even Keel runs as; a service under another Windows account does not see the user's own. */
export interface AwsProfiles {
  profiles: AwsProfile[]
  /** Who Even Keel runs as and the home its `~/.aws` is in, for the page to say whose files were read. */
  user: string
  home: string
}

export const BEDROCK_SWITCH = 'CLAUDE_CODE_USE_BEDROCK'
const MODEL_VARIABLES = { opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' } as const
const BEDROCK_VARIABLES = {
  region: 'AWS_REGION',
  profile: 'AWS_PROFILE',
  apiKey: 'AWS_BEARER_TOKEN_BEDROCK',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
  sessionToken: 'AWS_SESSION_TOKEN',
  regionPrefix: 'ANTHROPIC_BEDROCK_REGION_PREFIX',
} as const

/**
 * Every variable a cloud folder may hold. The transfer of the shared configuration takes them from the folder only, so
 * a model pinned in `~/.claude` for Anthropic's API does not reach a cloud that names its models otherwise.
 */
export const CLOUD_VARIABLES: readonly string[] = [BEDROCK_SWITCH, ...Object.values(BEDROCK_VARIABLES), ...Object.values(MODEL_VARIABLES)]

/** A short-term Bedrock API key is a presigned URL and lives up to 12 hours; a long-term one starts with `ABSK`. */
const SHORT_BEDROCK_KEY = /^bedrock-api-key-/

export function shortBedrockKey(key: string): boolean {
  return SHORT_BEDROCK_KEY.test(key.trim())
}

/** The `env` the folder's `settings.json` gets: only what is set, so the CLI's own order fills the rest. */
export function cloudEnv(connection: CloudConnection): Record<string, string> {
  const env: Record<string, string> = { [BEDROCK_SWITCH]: '1' }
  const set = (name: string, value: string | undefined) => {
    if (value !== undefined && value !== '') env[name] = value
  }
  set(BEDROCK_VARIABLES.region, connection.region)
  const { auth } = connection
  if (auth.way === 'profile') set(BEDROCK_VARIABLES.profile, auth.profile)
  if (auth.way === 'apiKey') set(BEDROCK_VARIABLES.apiKey, auth.key)
  if (auth.way === 'keys') {
    set(BEDROCK_VARIABLES.accessKeyId, auth.accessKeyId)
    set(BEDROCK_VARIABLES.secretAccessKey, auth.secretAccessKey)
    set(BEDROCK_VARIABLES.sessionToken, auth.sessionToken)
  }
  for (const family of ['opus', 'sonnet', 'haiku'] as const) set(MODEL_VARIABLES[family], connection.models?.[family])
  set(BEDROCK_VARIABLES.regionPrefix, connection.regionPrefix)
  return env
}

/**
 * The cloud a folder's `settings.json` `env` connects to; null for one on a subscription or a key. A profile's own
 * expiry is not in the env: `shortLivedProfile` tells it from `~/.aws`.
 */
export function cloudOf(env: Record<string, unknown>, shortLivedProfile: (profile: string) => boolean = () => false): CloudSummary | null {
  if (!truthy(env[BEDROCK_SWITCH])) return null
  const text = (name: string): string | undefined => (typeof env[name] === 'string' && env[name] !== '' ? (env[name] as string) : undefined)
  const profile = text(BEDROCK_VARIABLES.profile)
  const key = text(BEDROCK_VARIABLES.apiKey)
  const way: BedrockWay = key !== undefined ? 'apiKey' : text(BEDROCK_VARIABLES.accessKeyId) !== undefined ? 'keys' : profile !== undefined ? 'profile' : 'environment'
  const models: CloudModels = {}
  for (const family of ['opus', 'sonnet', 'haiku'] as const) {
    const model = text(MODEL_VARIABLES[family])
    if (model !== undefined) models[family] = model
  }
  const shortLived =
    way === 'apiKey' ? SHORT_BEDROCK_KEY.test(key!) : way === 'keys' ? text(BEDROCK_VARIABLES.sessionToken) !== undefined : way === 'profile' && shortLivedProfile(profile!)
  return {
    cloud: 'bedrock',
    region: text(BEDROCK_VARIABLES.region) ?? null,
    way,
    ...(way === 'profile' && { profile }),
    models,
    shortLived,
  }
}

/** The CLI reads a switch as on for `1` or `true`, in any case. */
function truthy(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true'].includes(value.trim().toLowerCase())
}

/** A request's connection, trimmed; a missing field the way needs is refused naming it. */
export function cloudConnectionOf(body: Record<string, unknown>): CloudConnection {
  const cloud = body.cloud
  if (!CLOUDS.includes(cloud as Cloud)) throw fail('request.required', { field: 'cloud' })
  if (!CLOUDS_READY.includes(cloud as Cloud)) throw fail('account.cloudNotReady', { cloud: String(cloud) })
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
  const need = (value: unknown, field: string): string => {
    const given = text(value)
    if (given === undefined) throw fail('request.required', { field })
    if (/\s/.test(given)) throw fail('account.cloudFieldInvalid', { field })
    return given
  }
  const way = body.way
  if (!BEDROCK_WAYS.includes(way as BedrockWay)) throw fail('request.required', { field: 'way' })
  const auth: BedrockAuth =
    way === 'profile'
      ? { way, profile: need(body.profile, 'profile') }
      : way === 'apiKey'
        ? { way, key: need(body.key, 'key') }
        : way === 'keys'
          ? {
              way,
              accessKeyId: need(body.accessKeyId, 'accessKeyId'),
              secretAccessKey: need(body.secretAccessKey, 'secretAccessKey'),
              ...(text(body.sessionToken) !== undefined && { sessionToken: need(body.sessionToken, 'sessionToken') }),
            }
          : { way: 'environment' }
  const models: CloudModels = {}
  const given = typeof body.models === 'object' && body.models !== null ? (body.models as Record<string, unknown>) : {}
  for (const family of ['opus', 'sonnet', 'haiku'] as const) {
    if (text(given[family]) !== undefined) models[family] = need(given[family], family)
  }
  const region = text(body.region) === undefined ? undefined : need(body.region, 'region')
  const regionPrefix = text(body.regionPrefix) === undefined ? undefined : need(body.regionPrefix, 'regionPrefix')
  return {
    cloud: 'bedrock',
    ...(region !== undefined && { region }),
    auth,
    ...(Object.keys(models).length > 0 && { models }),
    ...(regionPrefix !== undefined && { regionPrefix }),
  }
}
