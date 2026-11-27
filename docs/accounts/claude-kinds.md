# Keys and Claude account kinds

What every account on a key shares, whatever its agent, then the three Claude kinds besides a subscription: API, long-token and cloud accounts.

## Keys of any agent

An account on a key: Claude's or Codex's API key, OpenCode's provider key, Copilot's token. How each agent keeps its key is in its section (below, [`other-agents.md`](other-agents.md)).

### Replacing the key (BTN-418)

- A revoked or expired key needs no new account: "Replace key" ("Replace token" for Copilot) in the row's ⋯ menu (`AccountRowMenu`), shown whenever the key may be replaced, working or not, and the button next to "The key isn't accepted", open a field for the new one (`ReplaceKeyDialog`, command `account/key`, `AccountWatcher.replaceApiKey`).
- The key goes into the same folder, so its name, roles, pools and Tally history stay: Claude's `env.ANTHROPIC_API_KEY` in `settings.json` and its last 20 characters in `customApiKeyResponses.approved` of `.claude.json` in place of the old key's (the rest of both files as it was), Codex's `OPENAI_API_KEY` in `auth.json`, OpenCode's provider entry in `auth.json` (`replaceKey`), Copilot's token.
- Refused before anything is written:
  - a key of the wrong form, as on adding;
  - a folder that does not keep its key itself — the agent's own folder or one with `apiKeyHelper` (`AccountEntry.keyReplaceable`, `account.keyNotHeld`);
  - an OpenCode key of another provider than the one the folder holds (`account.keyOtherProvider`);
  - a key the provider refuses or that cannot be checked, as on adding;
  - a key of another organization (next section).
- The new key's verdict counts at once, so the card stops saying it is refused and the chain may switch to the account again. Running sessions keep the key they started with (invariant 1); new ones read the new one, as `settings.json` and `auth.json` are read at a session's start.

### The key's organization

- An API key's account is the organization that pays: a key of another one is another account. Anthropic and OpenAI keys only.
- A working key's answer names it (`KeyVerdict.organization`): Anthropic's header `anthropic-organization-id` on the models list; OpenAI's `openai-organization` on `GET /v1/me`, asked only after the models list took the key, since OpenAI's models list carries no such header (BTN-649). A refused key's 401 names none.
- It is kept while the key works — on adding and on each hourly check with a 2xx — in the state database (`key_organizations`, `docs/storage.md`; `src/account/organizations.ts`).
- A replacing key of another organization than the kept one is refused (`account.keyOtherOrganization`) and the old key stays. With none kept or an answer without the header, the key is taken and its organization kept.
- OpenAI's `/v1/me` failing — a restricted key without the right, an error, the network — leaves the models list's verdict: the key works, its organization unknown.
- A workspace inside the organization is not checked: it cannot be seen without an Admin key, and the same organization pays.
- Anthropic's header, the refusal and a second key of the same organization were seen live, OpenAI's header on `/v1/me` too ([verified](../verified/accounts.md)); the refusal of another OpenAI organization's key and a restricted key's `/v1/me` were not ([unverified](../unverified/sessions.md#an-api-keys-organization-header)).

### A key out of credit (BTN-165)

- A key out of credit is held on the current task as on a limit (`docs/chain/exceptions.md`, exception 1): the CLI's `billing_error` ("Credit balance is too low") is `apiError.kind` `credit`, its status lamp `limit`. Codex's and OpenCode's texts: [`other-agents.md`](other-agents.md).
- Its "reset" is the moment the credit is back. While the dispatcher asks (`AccountWatcher.creditBackAfter`), the watcher checks the key every 5 minutes (`CreditChecks`, `checkCredit(agent, key)` in `src/account/credit.ts`, in memory), starting 5 minutes after the stop and ending once access returns or 10 minutes after the dispatcher stopped asking.
- The check is one smallest paid request of the key's provider:
  - Anthropic: the models list for the cheapest model (a Haiku, else the newest), then `/v1/messages` with `max_tokens: 1`, a fraction of a cent. Only 2xx restores access; a 400 saying "credit balance is too low" or that the API usage limits were reached keeps waiting; anything else learns nothing and is logged.
  - OpenAI (`checkOpenAiCredit`): the models list for a `gpt-` text model with `nano` in its id, else `mini`, then `POST /v1/responses` with `max_output_tokens: 16` (the API's least) and `store: false`. 2xx is money; a 429 with `insufficient_quota` is none yet; a 429 of a rate limit and anything else learns nothing.
  - OpenRouter: [`other-agents.md`](other-agents.md), "OpenRouter".
  - A GitHub token never learns anything (`CREDIT_CHECKS`): Copilot waits for the month's reset.
- The panel says the key is out of credit and is checked (`t.session.creditOut`). The hold keeps `credit` (`LimitHold.credit`), so a cold handover after it is journaled with the cause `credit` and the task's session list says the key ran out of credit, not that it hit the usage limit. The service log still words it "limit reached".

### A spending cap (BTN-382)

- An Anthropic spending cap is held too: "reached your specified API usage limits" is `apiError.kind` `spend`, even when the CLI records `error: unknown`.
- Its "regain access on YYYY-MM-DD at HH:mm UTC" gives the reset (`src/limits/spending.ts`); a missing, invalid or past date leaves it unknown. The five-minute key check goes on even with a known reset: a 2xx allows an earlier resume or handoff if the cap was raised.
- The account card, the drawer and the session panel name the spending limit and its reset in local time; their hint explains the checks and switching accounts. The workspace variant of the text is accepted too; real recovery is [unverified](../unverified/sessions.md#api-spending-cap-recovery).

### Spend instead of limits

- An account on a key has no limit windows to show. The panel row, the account card and the header (while it is the active account) show the folder's spend since local midnight from Tally (`/api/stats/spend`, `docs/stats.md`; on an OpenRouter key a session's real spend read from the key, where Even Keel has it), refreshed every 5 minutes and fetched only while some account is on a key. Without Tally there is no figure.
- Copilot's token is the exception: it is polled like a subscription ([`other-agents.md`](other-agents.md), "The monthly allowance").

## API accounts (BTN-99)

An API account is a Claude folder whose sessions pay from an Anthropic API key instead of a subscription.

- **What is made.** "API key" in the add dialog (`AddAccountDialog`, command `account/api`, `AccountHomes.addApiKey`) creates `~/.claude-accounts/<folder>` with `settings.json` = `{ "env": { "ANTHROPIC_API_KEY": "…" } }`, and `.claude.json` with the key's last 20 characters in `customApiKeyResponses.approved`, otherwise the CLI asks whether to use the key.
- **The check on adding.** A key shorter than 21 characters or with spaces is refused (`account.apiKeyInvalid`). Then the key is checked with Anthropic (`checkApiKey`, `src/account/keycheck.ts`): `GET /v1/models?limit=1`, which costs no tokens. 401 or 403 refuses it (`account.apiKeyRejected`); a network error, a timeout or any other status refuses it as unchecked (`account.apiKeyUnchecked`), so no folder is made with a key nobody looked at.
- **The hourly check.** The watcher checks each API account's key from its `settings.json` once an hour (`KeyChecks`, in memory, so at every start too). A refused key makes the account `needsLogin`: the page says the key isn't accepted, and the chain neither switches to it nor launches on it. A check that learns nothing keeps the last verdict.
- **`apiKeyHelper`.** A folder set up by hand with `apiKeyHelper` instead of the variable works the same way, but is not checked: there is no key to read.
- **The account's name.** The name from the form is not the folder name. The folder is the name made safe for a path (`folderName`: `Team API` → `team-api`, `api` when the name is empty, `-2` when taken) and stays the account's identity: the key in commands and `state/`, and its stand-in e-mail (`withIdentity`). The name is kept in `state/account.json` as `accounts.<folder>.name` (`nameAccount`) and goes away with the account; the page shows it instead of the folder, and the folder in the account's details.
- **Its sign-in.** `claude auth status --json` in such a folder says `loggedIn: true`, `authMethod: "api_key"` (`"api_key_helper"` with a helper) and no e-mail (`isApiKey`). The folder key stands in for the e-mail wherever an account is told apart by it (`withIdentity`): the limit owner, `state/account.json`, the session pills.
- **The transfer** keeps the folder's own `env.ANTHROPIC_API_KEY` and `apiKeyHelper` over the global settings (`mergeSettings`); every other key still comes from `~/.claude`.
- **Transport.** How a Claude folder runs its sessions is the shared setting `execution.claude` (BTN-353; `auto` by default, `bg`, `sdk`; `transportOf`): `auto` runs a key folder through the Agent SDK and a subscription on `--bg` (`docs/sessions/sdk.md`, "The Agent SDK transport"). The card only says it (`TransportNote`, "Sessions through …", with Anthropic's rule in the tip of a subscription on the SDK); adding a key asks nothing. An older state file's per-folder choices become the setting once at the service's start (`executionOfChoices`).
- **What it does not have:** limits — `/usage` is not polled (it would answer free with no window lines), there are no limit bars, and a key's `rate_limit` stops a session like any error (invariant 1); sign-in renewal and `claude auth logout` on removal; Remote Control, which needs a claude.ai sign-in (`RemoteOff` `api-key`).
- The prompt cache lifetime of sessions on a key is 5 minutes by default; the `cacheTtl` config key changes it (`docs/sessions/cache.md`).
- Chain tasks on such a key ran to Done both through `--bg` and the SDK ([verified](../verified/accounts.md)).

## Long-token accounts (BTN-1005)

A long-token account is a Claude subscription folder signed in with the token of `claude setup-token` instead of the CLI's full sign-in.

- **Adding.** The add dialog's "Subscription" way offers both as a second row of cards ("Full sign-in", picked by default, and "Long token"); the token goes through `account/token` (`name`, `token`, optional `sameAs`; `AccountWatcher.addLongToken`, `addTokenAccount` in `src/account/tokenAccount.ts`).
- **Storage.** The token is `env.CLAUDE_CODE_OAUTH_TOKEN` in the folder's `settings.json`, as an API account's key: the CLI reads it there for `--bg` and the Agent SDK alike, and the transfer keeps it (`mergeSettings`). Beside it `even-keel-token.json` (`src/account/longToken.ts`) holds `until` — the day it was added plus a year, since the token carries no readable date — `sameAs` and `refusedAt`. A folder whose `settings.json` got the token by hand is a long-token account too, with no known last day.
- **The check turn.** `claude auth status` answers `loggedIn: true` for any token, a made-up one too, so a token is checked by one short turn in the new folder before the account is kept. A refusal removes the folder and shows the reason under the token field (`account.tokenRejected`); a value not of a token's form is refused at once (`account.tokenInvalid`).
- **The page does not run `claude setup-token`.** It prints nothing without a terminal, and Even Keel has no pty: the dialog shows the command for the user's own terminal and a secret field for the token it prints. Decided: no pty dependency; wait for a CLI flag that prints the link and the token without a terminal, looked for at each raise of Claude's `checked` (`docs/releases.md`, "Checking a CLI version"). The probe behind it: [verified](../verified/accounts.md).
- **Limits.** `/usage` gives such a folder no windows, so it is not polled and never raises the "/usage unread" warning (`LimitsWatcher.usage` answers `ok` for it). The limits are what the folder's sessions report (`withSessionLimits`): the five hours and the week, no model's own week, nothing between sessions, so an early reset is not seen and a chain that hit the limit waits for the reset it was told. With `sameAs` — a Claude folder on a full sign-in of the same account, picked in the dialog — the token folder shows and feeds that folder's limits instead; a `sameAs` folder removed or put on a token itself is ignored.
- **A refused token.** The account needs a sign-in once `until` has passed or a session of the folder was refused with `authentication_failed` (the session error kind `auth`; the session stops as on any error, invariant 1). `refusedAt` is written into the file, so it outlives a restart; a new token clears it.
- **A new token** goes into the same folder through `account/key` (`replaceToken`): the check turn runs on it, and the old token and file come back when it is refused. The page calls it "Issue a new token": in the row's menu always, and as a button in the problem band under the row — red once the token is refused or past its day, yellow for its last 30 days.
- **What it does not have:** Remote Control (the CLI refuses it on an inference-only token; the session's reason is `long-token`), an e-mail (the row is named by the name given, else as a nameless account), `claude auth logout` on removal, and the OAuth diagnostics, as there is no `.credentials.json` to watch.
- **On a machine elsewhere** (BTN-1002):
  - The hub's page signs a machine in on a long token instead of the browser sign-in: "Long token" next to "Sign in" under a hub account and in step 3 of "Add a machine" (`docs/machines/machine-side.md`, "Signing in on a machine").
  - The token file then holds `account` — the hub's claude.ai account (`accountUuid` and e-mail) picked by the row, since `auth status` on a token names none. The machine posts the folder under that account with `polls: false`, so the hub's full sign-in polls `/usage` and hands the machine its limits, and the machine's session windows go back to the hub. One full sign-in of the account is enough, best on the hub.
  - "Add account" on a machine offers the hub's two cards for Claude, and under "Long token" first the tokens the hub's own folders run on (BTN-1501, `machines/sharedToken`): the hub reads the token from its folder's `settings.json` and sends it the same way, so the page never holds it.
- **When which.** A full sign-in gives Remote Control, `/usage` with the models' own weeks and the OAuth diagnostics; a long token needs no browser on the machine and lives a year, but gives none of them. A machine without a browser or a person at it takes the token; a machine whose sessions the person answers through Remote Control takes the full sign-in.
- Its sessions run as a subscription's do (`--bg` under `auto`). Not seen live yet: [the token's real lifetime and its refusals](../unverified/accounts.md#a-claude-subscription-on-a-long-token-btn-1005).

## Cloud accounts (BTN-822)

A cloud account is a Claude folder whose sessions run on a cloud's Claude models and are billed by that cloud: `CLOUDS` in `src/account/cloud.ts` (`bedrock`, `vertex`, `foundry`), all three can be added. The add dialog's third way for Claude Code, "Cloud", picks the cloud and how its credentials are found (`CLOUD_WAYS`).

### Per cloud

- **Amazon Bedrock** (`BEDROCK_WAYS`):
  - ways in: an AWS profile, a Bedrock API key, an access key pair (with an optional session token), or the environment the service already has;
  - optional: the region, the Opus/Sonnet/Haiku model ids or inference profile ARNs, the inference profile prefix;
  - `env`: `CLAUDE_CODE_USE_BEDROCK=1` plus `AWS_PROFILE`, `AWS_BEARER_TOKEN_BEDROCK` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, `AWS_REGION`, `ANTHROPIC_BEDROCK_REGION_PREFIX`, `ANTHROPIC_DEFAULT_*_MODEL`;
  - profiles come from the files of the user the service runs as (`src/account/aws.ts`: `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE`, else `~/.aws/config` and `~/.aws/credentials`), read by `account/aws` into `AccountView.aws` for the profile field's suggestions; the field names that user, since a service under another Windows user does not see the person's own `~/.aws`.
- **Google Vertex AI** (`VERTEX_WAYS`, BTN-823):
  - ways in: the ADC file of `gcloud auth application-default login`, a key file (a service account's JSON key or a Workload Identity Federation config), or the service's environment;
  - required: the project id; optional: the region (`global`, `us`, `eu` or a region; the CLI's default is `us-east5`), the model ids (`claude-sonnet-4-5@20250929`), a region per model — the form's choices are `VERTEX_REGION_MODELS`, as of CLI 2.1.319, the server takes any `VERTEX_REGION_CLAUDE_*`;
  - `env`: `CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID` (the CLI takes the project only from it, not from `GOOGLE_CLOUD_PROJECT` or the key file), `CLOUD_ML_REGION`, `GOOGLE_APPLICATION_CREDENTIALS` for the key file way, `VERTEX_REGION_CLAUDE_*` and the model variables. The ADC and environment ways write the same `env`, as the CLI's own wizard does, so such an account reads back as `keyFile` or `adc`;
  - credentials (`src/account/gcloud.ts`, `account/gcloud` → `AccountView.gcloud`): the gcloud folder of the service's user (`CLOUDSDK_CONFIG`, else `%APPDATA%\gcloud` or `~/.config/gcloud`), whether its ADC file is there and of which `type`, the service's own `GOOGLE_APPLICATION_CREDENTIALS`, and the projects of the gcloud configurations and the ADC's quota project for the project field. The ADC way without the file shows the login command to run as that user.
- **Microsoft Foundry** (`FOUNDRY_WAYS`, BTN-824):
  - ways in: the resource's API key, Microsoft Entra ID through the Azure SDK's chain (the service's environment, `az login` of its user, the machine's managed identity), or a Bearer token of about an hour;
  - required: the resource, as its bare name or its full `https://<name>.services.ai.azure.com/anthropic` address in one field (`foundryEndpointOf` tells which, and why a value is neither, by CLI 2.1.319's own checks), and at least one deployment name, since Foundry has no model check at start; no region, the resource has one. The CLI tells a model's context window by its id, so a deployment named otherwise gets 200K unless the folder's `settings.json` `modelOverrides` maps the model id to it; the form says to name deployments after their models;
  - `env`: `CLAUDE_CODE_USE_FOUNDRY=1`, `ANTHROPIC_FOUNDRY_RESOURCE` or `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_FOUNDRY_API_KEY` or `ANTHROPIC_FOUNDRY_AUTH_TOKEN` (neither for Entra ID; read back in the CLI's order: a token, a key, else Entra ID) and the model variables holding deployment names;
  - the Azure sign-in (`src/account/azure.ts`, `account/azure` → `AccountView.azure`, read when the form picks Entra ID): whether the service user's `azureProfile.json` (`AZURE_CONFIG_DIR`, else `~/.azure`) lists a subscription, and whether the service's environment holds a service principal (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and a secret, certificate or federated token file). With neither the form shows `az login` to run as that user.

### Common to the clouds

- **The whole connection is the folder's `settings.json` `env`** (`cloudEnv`); the database holds nothing of it. The page reads the connection back from the file (`AccountHomes.cloudOf` → `AccountEntry.cloud`, secrets left out). The transfer keeps the folder's cloud variables (`isCloudVariable`) and drops the same variables from the global settings (`mergeSettings`), so a global `AWS_PROFILE` never moves a subscription folder onto a cloud.
- **The check before adding.** `account/cloud` → `AccountWatcher.addCloud`: the folder is made, one short turn runs on it through `Agent.write` (`claude -p`, prompt and timeout `CLOUD_CHECK_*` in `src/account/service-defaults.ts`, 120 s — the CLI gives up on AWS credentials after 60 s itself), and a refusal removes the folder again. The answer is the cloud's reason (`cloudErrorNotice` in `src/account/cloud-errors.ts`) or `account.cloudCheckFailed` with the CLI's text:
  - Bedrock: credentials, credential timeout, payment method, model access, on-demand region, throttling;
  - Vertex (its patterns go first and match only Google's own words): Google's credentials, billing, the disabled `aiplatform.googleapis.com`, a model not in Model Garden or the region, quota, IAM permission;
  - Foundry: Azure's credentials, a missing deployment, a subscription that cannot buy Claude, a refused key or token, throttling, and — only at the check of a new account — a connection error read as an unreachable resource.
  The model that answered is kept in memory (`AccountEntry.checkedModel`) for the dialog's "Checked and added" step.
- **Short-lived credentials** (`cloudShortLived`, `shortLivedProfile`): a profile with `sso_session`, `sso_start_url`, `login_session` or `aws_session_token`, a short-term Bedrock API key (`bedrock-api-key-` prefix), a key pair with a session token; on Vertex a user's ADC (`authorized_user`; `userCredentials` in `gcloud.ts`), since the organization's session policy may ask for a new sign-in — a key file is not, and the environment way counts as a user's ADC only without the service's own `GOOGLE_APPLICATION_CREDENTIALS`; on Foundry the token way, as the CLI does not renew a static token. They expire within hours and are renewed in a browser, so the dialog and the account's tip warn, in a text per cloud, that a chain left alone overnight stops; the long-lived ways are the fix.
- **What it does not have**, like an API account: it pays per token (`paysPerToken` — `authMethod` `third_party` — on the server and the page), so `/usage` is not polled, limits are never waited out and there are no limit bars; the row shows spend instead (Tally) and the region as its plan. Tally prices a model by the longest price whose name prefixes its id, so a cloud id (`us.anthropic.claude-…`, an ARN) counts only with a price row of its own in `tally.config.json` (the collector logs it as unpriced); the spend tip says so (`cloudSpendTitle`). No claude.ai sign-in, renewal or `claude auth logout`, no Remote Control (`RemoteOff` `api-key`), no WebSearch (Bedrock has none). `execution.claude` `auto` runs it through the Agent SDK like a key (`docs/sessions/sdk.md`).
- **Errors in a session.** Bedrock throttling, a Vertex quota refusal (429 `RESOURCE_EXHAUSTED`), Foundry's `RateLimitReached` and the refusals above are `apiError.kind` `error` with their `notice`: the session stops as on any error (invariant 1) and is never held as a limit, since throttling has no known reset.
- The page's connection groups of the clouds: [`page.md`](page.md), "The page `/accounts`".
- None of the three was run live: [Bedrock](../unverified/accounts.md#claude-on-amazon-bedrock-btn-822), [Vertex](../unverified/accounts.md#claude-on-google-vertex-ai-btn-823), [Foundry](../unverified/accounts.md#claude-on-microsoft-foundry-btn-824).
