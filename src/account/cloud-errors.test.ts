import { describe, expect, it } from 'vitest'
import { cloudErrorNotice } from './cloud-errors.js'

const whose = { user: 'john', home: 'C:\\Users\\john' }

describe('cloudErrorNotice', () => {
  it.each([
    ['API Error: 403 You don\'t have access to the model with the specified model id.', 'cloud.bedrockModelDenied'],
    ['API Error (us.anthropic.claude-opus-fake): anthropic.claude-opus-fake is not available for this account', 'cloud.bedrockModelDenied'],
    ['AccessDeniedException: Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions', 'cloud.bedrockModelDenied'],
    ['User: arn:aws:iam::000000000000:user/john is not authorized to perform: bedrock:InvokeModel on resource', 'cloud.bedrockModelDenied'],
    ['Your AWS Marketplace subscription for this model cannot be completed at this time.', 'cloud.bedrockModelDenied'],
    ['AccessDeniedException: INVALID_PAYMENT_INSTRUMENT: A valid payment instrument must be provided.', 'cloud.bedrockPayment'],
    ['AWS default-chain credential resolve timed out after 60000ms', 'cloud.awsTimeout'],
    ['Could not load credentials from any providers', 'cloud.awsCredentials'],
    ['No AWS credentials found.', 'cloud.awsCredentials'],
    ['ExpiredTokenException: The security token included in the request is expired', 'cloud.awsCredentials'],
    ['UnrecognizedClientException: The security token included in the request is invalid.', 'cloud.awsCredentials'],
    ['The SSO session associated with this profile has expired or is otherwise invalid.', 'cloud.awsCredentials'],
    ['ValidationException: Invocation of model ID anthropic.claude-fake with on-demand throughput isn\'t supported.', 'cloud.bedrockRegion'],
    ['400 The provided model identifier is invalid.', 'cloud.bedrockRegion'],
    ['ThrottlingException: Too many tokens, please wait before trying again.', 'cloud.throttled'],
    ['API Error: 429 Too many requests, please wait before trying again.', 'cloud.throttled'],
  ])('%s → %s', (text, code) => {
    expect(cloudErrorNotice(text, whose)?.code).toBe(code)
  })

  it('names whose AWS files a credential refusal was looked for in', () => {
    expect(cloudErrorNotice('No AWS credentials found.', whose)?.params).toEqual(whose)
    expect(cloudErrorNotice('No AWS credentials found.')?.params).toEqual({ user: '', home: '' })
  })

  it('leaves the errors of Anthropic’s own API alone', () => {
    expect(cloudErrorNotice('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')).toBeUndefined()
    expect(cloudErrorNotice('Claude AI usage limit reached|1794070000')).toBeUndefined()
    expect(cloudErrorNotice('API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}')).toBeUndefined()
  })
})
