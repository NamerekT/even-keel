import { CLOUD_WAYS, shortBedrockKey, type AwsProfiles, type Cloud, type CloudWay, type GcloudCredentials } from '../../src/account/cloud.js'

/** A model's own region on Vertex, typed as a row of the form: the `VERTEX_REGION_CLAUDE_*` variable and its region. */
export interface ModelRegion {
  variable: string
  region: string
}

/** What is typed for a cloud account (BTN-822, BTN-823); its secrets stay in the page's memory only, as an API key does. */
export interface CloudDraft {
  cloud: Cloud
  way: CloudWay
  profile: string
  key: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
  opus: string
  sonnet: string
  haiku: string
  regionPrefix: string
  projectId: string
  keyFile: string
  modelRegions: ModelRegion[]
}

export const EMPTY_CLOUD: CloudDraft = {
  cloud: 'bedrock',
  way: 'profile',
  profile: '',
  key: '',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  region: '',
  opus: '',
  sonnet: '',
  haiku: '',
  regionPrefix: '',
  projectId: '',
  keyFile: '',
  modelRegions: [],
}

/** The draft on another cloud: its first way, everything typed kept. */
export function withCloud(draft: CloudDraft, cloud: Cloud): CloudDraft {
  return cloud === draft.cloud ? draft : { ...draft, cloud, way: CLOUD_WAYS[cloud][0] ?? draft.way }
}

const filled = (value: string) => value.trim() !== ''

/** Whether every field the way needs is filled. */
export function cloudReady(draft: CloudDraft): boolean {
  if (draft.cloud === 'vertex') return filled(draft.projectId) && (draft.way !== 'keyFile' || filled(draft.keyFile))
  if (draft.way === 'profile') return filled(draft.profile)
  if (draft.way === 'apiKey') return filled(draft.key)
  if (draft.way === 'keys') return filled(draft.accessKeyId) && filled(draft.secretAccessKey)
  return true
}

/** The body of `account/cloud`: only what the way uses, so a secret typed for another way is not sent. */
export function cloudBody(name: string, draft: CloudDraft): Record<string, unknown> {
  const models = { opus: draft.opus, sonnet: draft.sonnet, haiku: draft.haiku }
  if (draft.cloud === 'vertex') {
    const modelRegions = Object.fromEntries(draft.modelRegions.filter((row) => filled(row.variable) && filled(row.region)).map((row) => [row.variable, row.region]))
    return {
      name,
      cloud: draft.cloud,
      way: draft.way,
      ...(draft.way === 'keyFile' && { keyFile: draft.keyFile }),
      projectId: draft.projectId,
      region: draft.region,
      models,
      modelRegions,
    }
  }
  const auth =
    draft.way === 'profile'
      ? { profile: draft.profile }
      : draft.way === 'apiKey'
        ? { key: draft.key }
        : draft.way === 'keys'
          ? { accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey, sessionToken: draft.sessionToken }
          : {}
  return { name, cloud: draft.cloud, way: draft.way, ...auth, region: draft.region, models, regionPrefix: draft.regionPrefix }
}

/**
 * The credentials expire or may ask for a new sign-in, so a chain left alone stops: the form warns. On Vertex that is a
 * user's ADC sign-in; a key file the service's environment names is taken for a service account's.
 */
export function cloudShortLived(draft: CloudDraft, aws: AwsProfiles | undefined, gcloud?: GcloudCredentials): boolean {
  if (draft.cloud === 'vertex') {
    if (draft.way === 'keyFile' || gcloud === undefined) return false
    if (draft.way === 'environment' && gcloud.environmentFile !== null) return false
    return gcloud.adcType === 'authorized_user'
  }
  if (draft.way === 'apiKey') return shortBedrockKey(draft.key)
  if (draft.way === 'keys') return draft.sessionToken.trim() !== ''
  if (draft.way === 'profile') return aws?.profiles.find((profile) => profile.name === draft.profile.trim())?.shortLived ?? false
  return false
}

/** Whether closing loses something typed into the cloud fields. */
export function cloudDirty(draft: CloudDraft | undefined): boolean {
  if (draft === undefined) return false
  const typed = [draft.key, draft.accessKeyId, draft.secretAccessKey, draft.sessionToken, draft.opus, draft.sonnet, draft.haiku, draft.keyFile]
  return typed.some(filled) || draft.modelRegions.some((row) => filled(row.region))
}
