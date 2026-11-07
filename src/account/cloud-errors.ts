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

/** What a cloud refusal means and what to do, by the error's text; undefined for any other error. */
export function cloudErrorNotice(text: string, whose: Whose = NOBODY): Notice | undefined {
  return BEDROCK_ERRORS.find(([pattern]) => pattern.test(text))?.[1](whose)
}
