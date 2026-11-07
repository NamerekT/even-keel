import { fail } from '../notice/notice.js'

/**
 * A Claude account on a cloud (BTN-822): the CLI reaches the models through the cloud's own API, paid by the cloud's
 * bill. Every cloud is one of `CLOUDS`; only the ones of `CLOUDS_READY` can be added yet (Foundry follows).
 * Its whole connection is the `env` of the folder's `settings.json`, the way an API account holds its key.
 */
export const CLOUDS = ['bedrock', 'vertex', 'foundry'] as const
export type Cloud = (typeof CLOUDS)[number]
export const CLOUDS_READY: readonly Cloud[] = ['bedrock', 'vertex']

/** How a Bedrock account finds its AWS credentials. */
export const BEDROCK_WAYS = ['profile', 'apiKey', 'keys', 'environment'] as const
export type BedrockWay = (typeof BEDROCK_WAYS)[number]

/**
 * How a Vertex account finds its Google Cloud credentials (BTN-823): the ADC file `gcloud auth application-default
 * login` leaves, a key file (a service account's, or a Workload Identity Federation config), or the service's own.
 */
export const VERTEX_WAYS = ['adc', 'keyFile', 'environment'] as const
export type VertexWay = (typeof VERTEX_WAYS)[number]

export type CloudWay = BedrockWay | VertexWay

export const CLOUD_WAYS: Record<Cloud, readonly CloudWay[]> = { bedrock: BEDROCK_WAYS, vertex: VERTEX_WAYS, foundry: [] }

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

export type VertexAuth = { way: 'adc' } | { way: 'keyFile'; keyFile: string } | { way: 'environment' }

export interface VertexConnection {
  cloud: 'vertex'
  /** `ANTHROPIC_VERTEX_PROJECT_ID`: the CLI takes the project only from here, never from the key file. */
  projectId: string
  /** `CLOUD_ML_REGION`: `global`, `us`, `eu` or a region; the CLI's own default is `us-east5`. */
  region?: string
  auth: VertexAuth
  models?: CloudModels
  /** A model's own region by its `VERTEX_REGION_CLAUDE_*` variable, for a model the region above does not serve. */
  modelRegions?: Record<string, string>
}

export type CloudConnection = BedrockConnection | VertexConnection

/** What the page shows of a cloud account: never a secret. */
export interface CloudSummary {
  cloud: Cloud
  region: string | null
  way: CloudWay
  /** The AWS profile, for the `profile` way. */
  profile?: string
  /** The Google Cloud project of a Vertex account. */
  project?: string
  /** Pinned models by family. */
  models: CloudModels
  /** The credentials expire within hours or may ask for a new sign-in: a chain left alone stops (`shortLivedKey`). */
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

/** The Google Cloud credentials of the user Even Keel runs as, read when the Vertex form asks (`readGcloud`). */
export interface GcloudCredentials {
  user: string
  home: string
  /** Where the ADC file of that user is looked for. */
  adcFile: string
  /** The ADC file's `type` (`authorized_user`, `service_account`, `external_account`); null when there is none. */
  adcType: string | null
  /** `GOOGLE_APPLICATION_CREDENTIALS` of the service itself: it wins over the ADC file for ADC and the environment. */
  environmentFile: string | null
  /** The projects of the gcloud configurations and the ADC's quota project, for the project field to offer. */
  projects: string[]
}

/**
 * The models the CLI gives a region variable of their own, by model id prefix, as in 2.1.319. Only the form's choices:
 * the account takes any `VERTEX_REGION_CLAUDE_*`, so a newer model's variable works before this list knows it.
 */
export const VERTEX_REGION_MODELS: ReadonlyArray<readonly [model: string, variable: string]> = [
  ['claude-fable-5-1', 'VERTEX_REGION_CLAUDE_FABLE_5_1'],
  ['claude-fable-5', 'VERTEX_REGION_CLAUDE_FABLE_5'],
  ['claude-opus-5-5', 'VERTEX_REGION_CLAUDE_5_5_OPUS'],
  ['claude-sonnet-5-5', 'VERTEX_REGION_CLAUDE_5_5_SONNET'],
  ['claude-haiku-5-5', 'VERTEX_REGION_CLAUDE_HAIKU_5_5'],
  ['claude-opus-5', 'VERTEX_REGION_CLAUDE_5_OPUS'],
  ['claude-sonnet-5', 'VERTEX_REGION_CLAUDE_5_SONNET'],
  ['claude-opus-4-8', 'VERTEX_REGION_CLAUDE_4_8_OPUS'],
  ['claude-opus-4-7', 'VERTEX_REGION_CLAUDE_4_7_OPUS'],
  ['claude-opus-4-6', 'VERTEX_REGION_CLAUDE_4_6_OPUS'],
  ['claude-sonnet-4-6', 'VERTEX_REGION_CLAUDE_4_6_SONNET'],
  ['claude-opus-4-5', 'VERTEX_REGION_CLAUDE_4_5_OPUS'],
  ['claude-sonnet-4-5', 'VERTEX_REGION_CLAUDE_4_5_SONNET'],
  ['claude-haiku-4-5', 'VERTEX_REGION_CLAUDE_HAIKU_4_5'],
  ['claude-opus-4-1', 'VERTEX_REGION_CLAUDE_4_1_OPUS'],
  ['claude-opus-4', 'VERTEX_REGION_CLAUDE_4_0_OPUS'],
  ['claude-sonnet-4', 'VERTEX_REGION_CLAUDE_4_0_SONNET'],
  ['claude-3-7-sonnet', 'VERTEX_REGION_CLAUDE_3_7_SONNET'],
  ['claude-3-5-sonnet', 'VERTEX_REGION_CLAUDE_3_5_SONNET'],
  ['claude-3-5-haiku', 'VERTEX_REGION_CLAUDE_3_5_HAIKU'],
]

export const BEDROCK_SWITCH = 'CLAUDE_CODE_USE_BEDROCK'
export const VERTEX_SWITCH = 'CLAUDE_CODE_USE_VERTEX'
const MODEL_VARIABLES = { opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' } as const
const FAMILIES = ['opus', 'sonnet', 'haiku'] as const
const BEDROCK_VARIABLES = {
  region: 'AWS_REGION',
  profile: 'AWS_PROFILE',
  apiKey: 'AWS_BEARER_TOKEN_BEDROCK',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
  sessionToken: 'AWS_SESSION_TOKEN',
  regionPrefix: 'ANTHROPIC_BEDROCK_REGION_PREFIX',
} as const
const VERTEX_VARIABLES = { projectId: 'ANTHROPIC_VERTEX_PROJECT_ID', region: 'CLOUD_ML_REGION', keyFile: 'GOOGLE_APPLICATION_CREDENTIALS' } as const
const MODEL_REGION = /^VERTEX_REGION_CLAUDE_[A-Z0-9_]+$/

const CLOUD_VARIABLES: readonly string[] = [
  BEDROCK_SWITCH,
  VERTEX_SWITCH,
  ...Object.values(BEDROCK_VARIABLES),
  ...Object.values(VERTEX_VARIABLES),
  ...Object.values(MODEL_VARIABLES),
]

/**
 * A variable a cloud folder may hold. The transfer of the shared configuration takes them from the folder only, so
 * a model pinned in `~/.claude` for Anthropic's API does not reach a cloud that names its models otherwise.
 */
export function isCloudVariable(name: string): boolean {
  return CLOUD_VARIABLES.includes(name) || MODEL_REGION.test(name)
}

/** A short-term Bedrock API key is a presigned URL and lives up to 12 hours; a long-term one starts with `ABSK`. */
const SHORT_BEDROCK_KEY = /^bedrock-api-key-/

export function shortBedrockKey(key: string): boolean {
  return SHORT_BEDROCK_KEY.test(key.trim())
}

/** The `env` the folder's `settings.json` gets: only what is set, so the CLI's own order fills the rest. */
export function cloudEnv(connection: CloudConnection): Record<string, string> {
  const env: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (value !== undefined && value !== '') env[name] = value
  }
  if (connection.cloud === 'vertex') {
    env[VERTEX_SWITCH] = '1'
    set(VERTEX_VARIABLES.projectId, connection.projectId)
    set(VERTEX_VARIABLES.region, connection.region)
    if (connection.auth.way === 'keyFile') set(VERTEX_VARIABLES.keyFile, connection.auth.keyFile)
    for (const family of FAMILIES) set(MODEL_VARIABLES[family], connection.models?.[family])
    for (const [variable, region] of Object.entries(connection.modelRegions ?? {})) set(variable, region)
    return env
  }
  env[BEDROCK_SWITCH] = '1'
  set(BEDROCK_VARIABLES.region, connection.region)
  const { auth } = connection
  if (auth.way === 'profile') set(BEDROCK_VARIABLES.profile, auth.profile)
  if (auth.way === 'apiKey') set(BEDROCK_VARIABLES.apiKey, auth.key)
  if (auth.way === 'keys') {
    set(BEDROCK_VARIABLES.accessKeyId, auth.accessKeyId)
    set(BEDROCK_VARIABLES.secretAccessKey, auth.secretAccessKey)
    set(BEDROCK_VARIABLES.sessionToken, auth.sessionToken)
  }
  for (const family of FAMILIES) set(MODEL_VARIABLES[family], connection.models?.[family])
  set(BEDROCK_VARIABLES.regionPrefix, connection.regionPrefix)
  return env
}

/**
 * The cloud a folder's `settings.json` `env` connects to; null for one on a subscription or a key. What is not in the
 * env is asked: `shortLivedProfile` tells an AWS profile's expiry from `~/.aws`, `userCredentials` whether the Google
 * credentials file in effect — the key file, or for null the service's own — holds a user's sign-in.
 */
export function cloudOf(
  env: Record<string, unknown>,
  shortLivedProfile: (profile: string) => boolean = () => false,
  userCredentials: (keyFile: string | null) => boolean = () => false,
): CloudSummary | null {
  const text = (name: string): string | undefined => (typeof env[name] === 'string' && env[name] !== '' ? (env[name] as string) : undefined)
  const models: CloudModels = {}
  for (const family of FAMILIES) {
    const model = text(MODEL_VARIABLES[family])
    if (model !== undefined) models[family] = model
  }
  if (truthy(env[BEDROCK_SWITCH])) {
    const profile = text(BEDROCK_VARIABLES.profile)
    const key = text(BEDROCK_VARIABLES.apiKey)
    const way: BedrockWay = key !== undefined ? 'apiKey' : text(BEDROCK_VARIABLES.accessKeyId) !== undefined ? 'keys' : profile !== undefined ? 'profile' : 'environment'
    const shortLived =
      way === 'apiKey' ? SHORT_BEDROCK_KEY.test(key!) : way === 'keys' ? text(BEDROCK_VARIABLES.sessionToken) !== undefined : way === 'profile' && shortLivedProfile(profile!)
    return { cloud: 'bedrock', region: text(BEDROCK_VARIABLES.region) ?? null, way, ...(way === 'profile' && { profile }), models, shortLived }
  }
  if (truthy(env[VERTEX_SWITCH])) {
    // ADC and the service's environment write the same env, as the CLI's own wizard does: only a key file tells.
    const keyFile = text(VERTEX_VARIABLES.keyFile)
    const project = text(VERTEX_VARIABLES.projectId)
    return {
      cloud: 'vertex',
      region: text(VERTEX_VARIABLES.region) ?? null,
      way: keyFile !== undefined ? 'keyFile' : 'adc',
      ...(project !== undefined && { project }),
      models,
      shortLived: userCredentials(keyFile ?? null),
    }
  }
  return null
}

/** The CLI reads a switch as on for `1` or `true`, in any case. */
function truthy(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true'].includes(value.trim().toLowerCase())
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** A one-word field the request must hold; one with a space inside is a pasted value with a line break in it. */
function need(value: unknown, field: string): string {
  const given = text(value)
  if (given === undefined) throw fail('request.required', { field })
  if (/\s/.test(given)) throw fail('account.cloudFieldInvalid', { field })
  return given
}

/** A one-word field the request may hold; undefined when blank. */
function may(value: unknown, field: string): string | undefined {
  return text(value) === undefined ? undefined : need(value, field)
}

function modelsOf(body: Record<string, unknown>): CloudModels | undefined {
  const models: CloudModels = {}
  const given = typeof body.models === 'object' && body.models !== null ? (body.models as Record<string, unknown>) : {}
  for (const family of FAMILIES) {
    const model = may(given[family], family)
    if (model !== undefined) models[family] = model
  }
  return Object.keys(models).length > 0 ? models : undefined
}

/** A request's connection, trimmed; a missing field the way needs is refused naming it. */
export function cloudConnectionOf(body: Record<string, unknown>): CloudConnection {
  const cloud = body.cloud
  if (!CLOUDS.includes(cloud as Cloud)) throw fail('request.required', { field: 'cloud' })
  if (!CLOUDS_READY.includes(cloud as Cloud)) throw fail('account.cloudNotReady', { cloud: String(cloud) })
  return cloud === 'vertex' ? vertexConnectionOf(body) : bedrockConnectionOf(body)
}

function bedrockConnectionOf(body: Record<string, unknown>): BedrockConnection {
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
  const models = modelsOf(body)
  const region = may(body.region, 'region')
  const regionPrefix = may(body.regionPrefix, 'regionPrefix')
  return {
    cloud: 'bedrock',
    ...(region !== undefined && { region }),
    auth,
    ...(models !== undefined && { models }),
    ...(regionPrefix !== undefined && { regionPrefix }),
  }
}

function vertexConnectionOf(body: Record<string, unknown>): VertexConnection {
  const way = body.way
  if (!VERTEX_WAYS.includes(way as VertexWay)) throw fail('request.required', { field: 'way' })
  const projectId = need(body.projectId, 'projectId')
  let auth: VertexAuth = { way: way === 'adc' ? 'adc' : 'environment' }
  if (way === 'keyFile') {
    // A path may hold spaces (`C:\Users\John Doe\…`), never a line break.
    const keyFile = text(body.keyFile)
    if (keyFile === undefined) throw fail('request.required', { field: 'keyFile' })
    if (/[\r\n]/.test(keyFile)) throw fail('account.cloudFieldInvalid', { field: 'keyFile' })
    auth = { way, keyFile }
  }
  const regions: Record<string, string> = {}
  const given = typeof body.modelRegions === 'object' && body.modelRegions !== null ? (body.modelRegions as Record<string, unknown>) : {}
  for (const [variable, value] of Object.entries(given)) {
    if (!MODEL_REGION.test(variable)) throw fail('account.cloudFieldInvalid', { field: variable })
    const region = may(value, variable)
    if (region !== undefined) regions[variable] = region
  }
  const models = modelsOf(body)
  const region = may(body.region, 'region')
  return {
    cloud: 'vertex',
    projectId,
    ...(region !== undefined && { region }),
    auth,
    ...(models !== undefined && { models }),
    ...(Object.keys(regions).length > 0 && { modelRegions: regions }),
  }
}
