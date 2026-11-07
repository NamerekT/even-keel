import { shortBedrockKey, type AwsProfiles, type BedrockWay, type Cloud } from '../../src/account/cloud.js'

/** What is typed for a cloud account (BTN-822); its secrets stay in the page's memory only, as an API key does. */
export interface CloudDraft {
  cloud: Cloud
  way: BedrockWay
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
}

/** Whether every field the way needs is filled. */
export function cloudReady(draft: CloudDraft): boolean {
  const filled = (value: string) => value.trim() !== ''
  if (draft.way === 'profile') return filled(draft.profile)
  if (draft.way === 'apiKey') return filled(draft.key)
  if (draft.way === 'keys') return filled(draft.accessKeyId) && filled(draft.secretAccessKey)
  return true
}

/** The body of `account/cloud`: only what the way uses, so a secret typed for another way is not sent. */
export function cloudBody(name: string, draft: CloudDraft): Record<string, unknown> {
  const auth =
    draft.way === 'profile'
      ? { profile: draft.profile }
      : draft.way === 'apiKey'
        ? { key: draft.key }
        : draft.way === 'keys'
          ? { accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey, sessionToken: draft.sessionToken }
          : {}
  return {
    name,
    cloud: draft.cloud,
    way: draft.way,
    ...auth,
    region: draft.region,
    models: { opus: draft.opus, sonnet: draft.sonnet, haiku: draft.haiku },
    regionPrefix: draft.regionPrefix,
  }
}

/** The credentials expire within hours and are renewed in a browser, so a chain left alone stops: the form warns. */
export function cloudShortLived(draft: CloudDraft, aws: AwsProfiles | undefined): boolean {
  if (draft.way === 'apiKey') return shortBedrockKey(draft.key)
  if (draft.way === 'keys') return draft.sessionToken.trim() !== ''
  if (draft.way === 'profile') return aws?.profiles.find((profile) => profile.name === draft.profile.trim())?.shortLived ?? false
  return false
}

/** Whether closing loses something typed into the cloud fields. */
export function cloudDirty(draft: CloudDraft | undefined): boolean {
  if (draft === undefined) return false
  return [draft.key, draft.accessKeyId, draft.secretAccessKey, draft.sessionToken, draft.opus, draft.sonnet, draft.haiku].some((value) => value.trim() !== '')
}
