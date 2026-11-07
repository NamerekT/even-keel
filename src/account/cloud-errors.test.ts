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
    ['Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.', 'cloud.gcpCredentials'],
    ['The file at C:\\keys\\sa.json does not exist, or it is not a file. ENOENT: no such file or directory', 'cloud.gcpCredentials'],
    ['invalid_grant: reauth related error (invalid_rapt)', 'cloud.gcpCredentials'],
    ['invalid_grant: Token has been expired or revoked.', 'cloud.gcpCredentials'],
    ['Timed out waiting for GCP credentials', 'cloud.gcpCredentials'],
    [
      'API Error: 404 {"error":{"code":404,"message":"Publisher Model `projects/fake-project/locations/us-east5/publishers/anthropic/models/claude-opus-fake` not found.","status":"NOT_FOUND"}}',
      'cloud.vertexModel',
    ],
    [
      'API Error: 404 Publisher Model `projects/fake-project/locations/global/publishers/anthropic/models/claude-fake@20990101` was not found or your project does not have access to it.',
      'cloud.vertexModel',
    ],
    [
      'API Error: 429 {"error":{"code":429,"message":"Quota exceeded for aiplatform.googleapis.com/online_prediction_requests_per_base_model with base model: anthropic-claude-fake. Please submit a quota increase request.","status":"RESOURCE_EXHAUSTED"}}',
      'cloud.vertexQuota',
    ],
    [
      'API Error: 403 {"error":{"code":403,"message":"This API method requires billing to be enabled. Please enable billing on project #000000000000 by visiting https://console.developers.google.com/billing/enable?project=000000000000 then retry.","status":"PERMISSION_DENIED","details":[{"reason":"BILLING_DISABLED"}]}}',
      'cloud.vertexBilling',
    ],
    [
      'API Error: 403 {"error":{"code":403,"message":"Vertex AI API has not been used in project 000000000000 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=000000000000","status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}',
      'cloud.vertexApi',
    ],
    [
      'API Error: 403 {"error":{"code":403,"message":"Permission \'aiplatform.endpoints.predict\' denied on resource \'//aiplatform.googleapis.com/projects/fake-project/locations/us-east5/publishers/anthropic/models/claude-fake\' (or it may not exist).","status":"PERMISSION_DENIED"}}',
      'cloud.vertexPermission',
    ],
  ])('%s → %s', (text, code) => {
    expect(cloudErrorNotice(text, whose)?.code).toBe(code)
  })

  it('names whose AWS files a credential refusal was looked for in', () => {
    expect(cloudErrorNotice('No AWS credentials found.', whose)?.params).toEqual(whose)
    expect(cloudErrorNotice('No AWS credentials found.')?.params).toEqual({ user: '', home: '' })
    expect(cloudErrorNotice('Could not load the default credentials.', whose)?.params).toEqual(whose)
  })

  it('leaves the errors of Anthropic’s own API alone', () => {
    expect(cloudErrorNotice('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')).toBeUndefined()
    expect(cloudErrorNotice('Claude AI usage limit reached|1794070000')).toBeUndefined()
    expect(cloudErrorNotice('API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}')).toBeUndefined()
    expect(cloudErrorNotice('API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-fake"}}')).toBeUndefined()
    expect(cloudErrorNotice('OAuth token refresh failed: invalid_grant')).toBeUndefined()
  })
})
