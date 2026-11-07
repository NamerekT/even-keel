import { notice, type Notice } from '../notice/notice.js'

/** Who Even Keel runs as and their home: empty where it is not known, as in a transcript the page reads too. */
export interface Whose {
  user: string
  home: string
}

const NOBODY: Whose = { user: '', home: '' }

/**
 * Bedrock's refusals as the CLI words them (its own table of `refused`, `denied` and `credential` in 2.1.319) and as AWS
 * answers, first match wins: a payment refusal also says access is denied, and a credential timeout is a credential error.
 */
const BEDROCK_ERRORS: Array<[RegExp, (whose: Whose) => Notice]> = [
  [/INVALID_PAYMENT_INSTRUMENT|valid payment instrument/i, () => notice('cloud.bedrockPayment', {})],
  [/default-chain credential resolve timed out/i, (whose) => notice('cloud.awsTimeout', whose)],
  [
    /Could not load credentials|No AWS credentials found|ExpiredToken|InvalidSignature|SignatureDoesNotMatch|UnrecognizedClient|InvalidClientTokenId|security token.*(invalid|expired)|SSO session.*expired|Token has expired|profile .* could not be found|CredentialsProviderError/i,
    (whose) => notice('cloud.awsCredentials', whose),
  ],
  [/on-demand throughput|provided model identifier is invalid/i, () => notice('cloud.bedrockRegion', {})],
  [
    /you don't have access to the model|anthropic\.\S+ is not available for this account|marketplace subscription for this model cannot be completed|is not authorized to perform: bedrock:InvokeModel|AccessDeniedException/i,
    () => notice('cloud.bedrockModelDenied', {}),
  ],
  [/ThrottlingException|TooManyRequestsException|Too many (requests|tokens), please wait/i, () => notice('cloud.throttled', {})],
]

/**
 * Vertex AI's refusals (BTN-823): Google's auth library as the CLI's own Vertex wizard reads it in 2.1.319, and Google
 * Cloud's error bodies. Billing goes before the disabled API, which a project without billing may also report. Every
 * pattern names Google's own words, so an `invalid_grant` or a 404 of Anthropic's API is left alone.
 */
const VERTEX_ERRORS: Array<[RegExp, (whose: Whose) => Notice]> = [
  [
    /Could not load the default credentials|does not exist, or it is not a file|The incoming JSON object does not|Must pass in a JSON object containing|invalid_rapt|reauth related error|Token has been expired or revoked|Timed out waiting for GCP credentials|Unable to detect a Project Id/i,
    (whose) => notice('cloud.gcpCredentials', whose),
  ],
  [/BILLING_DISABLED|requires billing to be enabled/i, () => notice('cloud.vertexBilling', {})],
  [/SERVICE_DISABLED|has not been used in project \S+ before or it is disabled/i, () => notice('cloud.vertexApi', {})],
  [/Publisher Model .*(not found|does not have access)/i, () => notice('cloud.vertexModel', {})],
  [/Quota exceeded for aiplatform\.googleapis\.com|RESOURCE_EXHAUSTED/i, () => notice('cloud.vertexQuota', {})],
  [/Permission '?aiplatform\.\S+'? denied/i, () => notice('cloud.vertexPermission', {})],
]

const CLOUD_ERRORS = [...VERTEX_ERRORS, ...BEDROCK_ERRORS]

/** What a cloud refusal means and what to do, by the error's text; undefined for any other error. */
export function cloudErrorNotice(text: string, whose: Whose = NOBODY): Notice | undefined {
  return CLOUD_ERRORS.find(([pattern]) => pattern.test(text))?.[1](whose)
}
