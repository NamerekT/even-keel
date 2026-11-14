# Accounts and limits

An account is one sign-in of one agent: a subscription, an API key or a cloud. Each has a folder of its own, so several can be signed in at once, and a project or a task runs on the one you choose. This page says how to add accounts, what each kind can do, how Even Keel reads their limits and what it does when one runs out.

- [Adding an account](#adding-an-account)
- [Subscriptions](#subscriptions)
- [API keys](#api-keys)
- [Claude on a cloud](#claude-on-a-cloud)
- [The accounts page](#the-accounts-page)
- [Limits](#limits)
- [Subscription credits and extra usage](#subscription-credits-and-extra-usage)
- [When Claude Code asks to sign in again](#when-claude-code-asks-to-sign-in-again)

## Adding an account

Accounts appear only after you add them.

In **Add account**, choose a provider: if its CLI already has a sign-in on this machine, the dialog offers that identity or signing in with another account. Otherwise it opens the usual sign-in choices.

The first account added for a provider takes its unused shared pool entry.

Removing an added global CLI account from Even Keel keeps its folder and CLI sign-in.

An update keeps global accounts that were already visible; a new installation starts without them.

A provider's Add opens its sign-in choices; Add account at the top also offers providers with no accounts, whose empty blocks are omitted.

Claude Code offers a subscription, an API key or a cloud (Amazon Bedrock, Google Vertex AI, Microsoft Foundry); Codex a ChatGPT subscription or API key; OpenCode ChatGPT, GitHub Copilot, free models or API key; Copilot this machine's sign-in or a token.

The dialog walks the sign-in steps, closes on success and highlights the added row. It opens over the current page, including setup and the project wizard.

A missing CLI disables its provider with installation help.

Until a provider has a registered shared account, its first added account takes that role.

An account uses its given name, else e-mail, else provider (numbered for duplicates); Rename in the row menu changes only that name, and an empty name restores the default.

## Subscriptions

Your own Claude and Codex subscriptions — a personal and a work one, say — one config folder each.

At most one ChatGPT account may be on the free plan across Codex and OpenCode: Even Keel refuses a different second free account and holds any already added. The same e-mail may be used in both agents, sharing its allowance.

Paid plans have no limit on the number of accounts. An unreadable plan remains unknown; Even Keel does not guess that it is free ([docs/accounts.md](../accounts.md#the-codex-folders-btn-168-btn-176)).

### OpenCode

OpenCode accounts are folders of their own too, signed in with ChatGPT or GitHub Copilot (a link and a one-time code), on an Anthropic or OpenAI API key, or with no sign-in for OpenCode's free models. There is no Claude subscription for OpenCode: Anthropic allows it only in Claude Code, so Claude in OpenCode is an API key ([docs/accounts.md](../accounts.md#the-opencode-folders-btn-214)).

OpenCode can use ChatGPT, API keys or its free models.

An API key may be Anthropic's (`sk-ant-…`), OpenAI's or OpenRouter's (`sk-or-…`): whose it is, is told by its start, and it is checked with that provider when added and hourly.

On an OpenRouter key a task's run or the run profile names any of OpenRouter's models, like `openrouter/minimax/minimax-m3.1-flash`; a session that runs out of money there is held until the key can pay again, as on other keys.

If you set a spending limit on the key itself in OpenRouter, the account's row shows what is left of it ("Key limit left") next to the spend.

The account's balance OpenRouter tells only to a management key: create one in OpenRouter's settings and add it with "Management key" in the account row's menu.

It is checked before it is saved, kept in Even Keel's own state rather than in the account folder, so sessions never see it, and used only to show "Balance" on the row; the same item replaces or removes it.

The balance read [has not yet been checked live](../unverified/opencode.md#the-openrouter-balance-by-a-management-key-btn-868). Sessions on an OpenRouter key have [not yet been checked live](../unverified/opencode.md#opencode-on-an-openrouter-key-btn-843).

**OpenCode on GitHub Copilot is not supported yet:** this combination has not passed a live session check, and Copilot Free's automatic model selection does not work with OpenCode's named-model calls. Existing Copilot sign-ins and credits remain visible, but a folder with only Copilot is unavailable for sessions. A folder with other providers can still use those providers; Copilot models are not offered.

If a saved model or a task's run selects Copilot, the chain pauses and links to session settings: choose another Model or Account and change the run on the task's card before resuming.

Adding Copilot sign-ins through OpenCode is unavailable. The separate GitHub Copilot CLI remains available.

To add a Go subscription, choose **Accounts → Add account → OpenCode → OpenCode Go** and enter its key from OpenCode Console. The page shows its 5-hour, weekly and monthly windows, refreshed every five minutes.

A Console key without Go keeps working as Zen. If the key expires or is revoked, create a new key in OpenCode Console and choose **Replace key** beside the warning or in the account menu; signing in again does not renew it.

When a Go refusal names a reset such as “in 5 days 10 hours”, the chain waits for that time instead of retrying blindly. The Go endpoint and percentage scale still need a [check with a real subscription](../unverified/opencode.md#opencode-go-limits-btn-803).

### GitHub Copilot

GitHub Copilot accounts are folders too.

One runs on the GitHub sign-in already on the machine (`copilot login`, which Copilot keeps for the whole machine, not per folder); for several GitHub accounts, add each with a fine-grained token that has the "Copilot Requests" permission.

GitHub's terms allow one free account per person: several tokens are for several paid seats, not to stretch a free budget ([docs/accounts.md](../accounts.md#the-copilot-folders-btn-215)).

An account added with a token shows its monthly allowance, "N left, resets on the 1st", and a spent one waits for the 1st; give the token the "Plan" read permission too, or the card can only count what was spent, or nothing.

A machine sign-in shows its monthly allowance when Copilot confirms that it uses GitHub CLI's sign-in; otherwise add an account with its own token to read its allowance. This fallback was checked in Windows session 0; Copilot's own saved OAuth sign-in and Linux/macOS remain [unverified](../unverified/copilot.md#copilots-machine-token-and-model-availability-btn-516).

The monthly allowance can count premium requests or AI credits. When GitHub provides credits used and the allowance, the card shows what is left.

A token's billing report can show only what was spent, without a remaining allowance; Even Keel also checks the AI credit report when the premium request report is empty or unavailable.

Give a fine-grained token the **Plan** read permission to allow these reports.

If GitHub supplies no quota or no usage rows, the card explains that no data is available; check GitHub's billing page. Paid-plan readings remain [unverified live](../unverified/copilot.md#a-copilot-tokens-monthly-allowance-btn-341).

## API keys

An account can also be an Anthropic API key, checked with Anthropic when added and then hourly: its sessions pay from the key, the page shows its spend today instead of usage windows (with statistics on), and it has no Remote Control.

A session whose key runs out of credit is held, the key is checked every 5 minutes, and the chain goes on once it is topped up ([account details](../accounts.md#api-accounts-btn-99)).

A spending cap also holds the current task: the account problem band and session panel show the reset date from the error, and the chain retries then, or sooner if a five-minute check succeeds after you raise the cap. You can switch accounts to continue immediately. Automatic recovery from a real spending cap and the workspace variant have [not yet been checked live](../unverified/sessions.md#api-spending-cap-recovery).

A Codex account can be an OpenAI API key the same way, checked with OpenAI; a Codex session whose key runs out of money is held the same way.

When a key is revoked or expires, the card says it isn't accepted: "Replace key" there or in its ⋯ menu takes a new one into the same account, so its name, roles and history stay.

The new key is checked first and the old one stays if it is refused; a key of another organization is refused too, as it is another account to add on its own. For OpenAI keys this refusal has [not yet been checked live](../unverified/sessions.md#an-api-keys-organization-header), and a restricted OpenAI key that may not read its own profile keeps no organization, so any key replaces it.

Sessions already running finish on the old key, new ones start on the new one. A Copilot token is replaced the same way.

An Anthropic API key's spending cap holds the current task in OpenCode too: the chain waits for the UTC reset named in the refusal and checks the key every five minutes, allowing earlier recovery after you raise the cap. Automatic recovery through a real cap still needs a [live check](../unverified/sessions.md#api-spending-cap-recovery).

## Claude on a cloud

A Claude Code account can run on Claude models in your own cloud account instead of a subscription or an Anthropic key: Amazon Bedrock, Google Vertex AI or Microsoft Foundry. The cloud bills it, and none of the three has run a live session yet.

### Amazon Bedrock

A Claude Code account can also run on Claude models in your Amazon Bedrock account, billed by AWS: **Add account** → **Cloud** → **Amazon Bedrock**.

Pick how Even Keel finds the AWS credentials — an AWS profile (suggested from the AWS files of the user Even Keel runs as, which under a Windows service may not be you), a Bedrock API key, an access key pair, or the environment Even Keel already runs with — and optionally the region, the models (an inference profile id like `us.anthropic.…` or its ARN) and the inference profile prefix.

One short turn checks the connection before the account is added; a refusal says why (no credentials, no model access, no payment method, a region that does not serve the model on demand) and adds nothing.

SSO profiles, short-term Bedrock API keys and keys with a session token expire within hours and are renewed in a browser, so the dialog warns: a chain left alone overnight stops on them, while a profile with a long-lived key or a long-term API key keeps going.

Like an API key, a Bedrock account has no usage windows (the page shows its spend and region), runs through the Agent SDK under `Auto`, and has no Remote Control; Bedrock also has no web search, so WebSearch does not work in its sessions. Bedrock throttling stops a session like any error rather than holding it as a limit.

A Bedrock account has [not yet run a live session](../unverified/accounts.md#claude-on-amazon-bedrock-btn-822); details are in [account details](../accounts.md#cloud-accounts-btn-822).

### Google Vertex AI

It can run on Claude models in a Google Cloud project the same way, billed by Google: **Add account** → **Cloud** → **Google Vertex AI**.

Enable the models in Model Garden first; the project needs a paid billing account, since trial credits do not pay for Claude.

Pick how Even Keel finds the Google Cloud credentials — the sign-in that `gcloud auth application-default login` leaves for the user Even Keel runs as (the dialog says whether that user has it, and gives the command if not), the path to a service account's JSON key (or a Workload Identity Federation config), or the environment Even Keel already runs with — then the project ID (suggested from that user's gcloud configurations) and optionally the region (`us-east5` by default; `global`, `us` or `eu` recommended), the models (a Vertex id like `claude-sonnet-4-5@20250929`) and a region of its own for a model the account's region does not serve.

One short turn checks the connection; a refusal says why (no credentials, billing or the Vertex AI API not enabled, a model not enabled or not in the region, quota, a missing permission) and adds nothing.

A new project's Claude quota is often zero: raise it in Cloud Quotas. A user's gcloud sign-in may ask for a new sign-in under the organization's session policy, so the dialog warns; for unattended work use a service account's key file.

A Vertex quota refusal stops a session like any error. Otherwise a Vertex account behaves like a Bedrock one, and it has [not yet run a live session](../unverified/accounts.md#claude-on-google-vertex-ai-btn-823) either.

### Microsoft Foundry

Or on Claude models deployed in a Microsoft Foundry resource, billed by Azure: **Add account** → **Cloud** → **Microsoft Foundry**.

Deploy the models in the Foundry portal first; Claude needs a pay-as-you-go Azure subscription with Marketplace access (not a free trial, student, credit or CSP one) and a resource in a region that serves it, such as East US 2 or Sweden Central.

Give the resource as its name (`my-resource`) or its full address (`https://my-resource.services.ai.azure.com/anthropic`), then how Even Keel signs in: the resource's API key, Microsoft Entra ID (`az login` of the user Even Keel runs as, a service principal in Even Keel's environment, or the machine's managed identity — the dialog says whether that user is signed in, and gives the command if not), or a Bearer token.

Then the deployment names for Opus, Sonnet and Haiku, at least one, exactly as the portal shows them.

One short turn checks the connection; a refusal says why (no Entra ID sign-in, a resource that does not answer, no such deployment, a subscription that cannot use Claude, a refused key or token, throttling) and adds nothing.

A token lives about an hour and is not renewed, so the dialog warns: for unattended work use a key or Entra ID.

Foundry throttling stops a session like any error. Otherwise a Foundry account behaves like a Bedrock one, and it has [not yet run a live session](../unverified/accounts.md#claude-on-microsoft-foundry-btn-824) either.

## The accounts page

The `/accounts` page and the header's Accounts panel group accounts in bordered provider blocks, with accounts at work first.

Each account is a row: its name, role chips and limits; the page also shows sessions (VS Code chats by tab title) and how they run.

Click the row, or focus it and press Enter/Space, to move Even Keel or VS Code onto it, rename it or remove it. Unavailable actions say why.

The Claude desktop app can be launched on a folder by hand ([account details](../accounts.md#the-claude-desktop-app)).

Problems appear above the list with their fix. Shared limits and the source and age of readings are in tips.

OpenCode and Copilot without a readable allowance share token counts for today and 30 days.

At phone widths a row keeps the name, role and the tightest used percentage of the plan's windows, with the model's name beside it when the account also has a model's own week (Fable); tapping the row opens its menu, whose head shows all the windows with their resets, the model's week and how old the reading is. The burger has one Accounts button with that percentage and an error dot.

The account row's menu opens at the horizontal position you click, below the row (above it when space is short), and stays inside the window. Enter/Space opens it at the row's default position.

### The account chip in the header

On a project's chain page, the header chip shows the account of its current session, or of the next task before it starts, including while the chain is paused or stopped.

Hover or focus shows up to three distinct accounts in order: the task, the project's default and Even Keel's default. A coloured border and stack count mark a cascade; on phones the chip keeps the tightest usage window.

Other pages show only Even Keel's account. Pressing the chip opens the full Accounts panel. Accounts without readable limits show token counts instead of empty limit rows.

## Limits

The windows of every subscription account are read every 5 minutes: Claude Code's 5-hour and weekly windows with its own `/usage` command (no quota spent; a plan with only one of them, such as a verified Ultra without the 5-hour one, shows the one it has), Codex and OpenCode's ChatGPT windows from ChatGPT, and Copilot's monthly allowance from GitHub.

Between those reads a Claude session running through the Agent SDK keeps its windows fresh with the limits the CLI reports at each response.

Even Keel stays inside them: while a window is exhausted the next task waits for its reset.

A Claude plan with a weekly limit of its own for one model (Max, Ultra and Team have one for Fable) shows it as one more meter in the account's row, named by the model; while that week is used up, a task on that model waits for it to open, and a task on another model of the plan goes on.

Usage warnings name each affected account in a shared or project account pool, including accounts of other providers; accounts that need sign-in show that on their card instead.

What happens to a session that hits a limit is in [Handoffs](sessions.md#on-a-usage-limit).

## Subscription credits and extra usage

Some plans let work go on past the included limit for money: usage credits, extra usage, paid requests. Even Keel shows what the provider reports and stops a chain session once it sees paid usage, so a chain does not spend money you did not mean to spend.

On the wide Accounts page, **Extra usage** shows the provider's reported credit balance, additional-usage permission or paid Copilot usage.

A dash means the provider has not supplied it. Point at or focus a value for its source, age and limitations.

ChatGPT balances are usage credits, not dollars; automatic reload settings and spending caps are not reported.

An amber **on credits** chip beside an account's name, including in the header and account panel, means a working session recently reported extra usage (Claude SDK), or is working with available ChatGPT credits and an exhausted included window.

The latter is an inference, explained in the tip.

The narrow page and panel keep this chip and their usual usage figure. OpenCode Zen has no readable balance here.

Even Keel stops the current chain session on fresh paid-usage evidence or an exhausted Claude allowance, including during a turn and on a paused chain.

Claude SDK reports paid usage directly. An exhausted Claude `/usage` window means paid usage is possible, not confirmed; the log and policy tip say so. Other supported subscription connections require an exhausted included window with available ChatGPT credits or Copilot paid-usage permission.

The chain retains its folder, branch and context, waits for allowance to reset or a usable account, then resumes a warm session or starts one with a handoff.

A shared ChatGPT allowance also holds after switching between Codex and OpenCode.

An unknown reset stays unknown; historical paid totals alone never trigger a stop. API-key recovery stays as before.

An account with known paid usage available shows a warning and **Provider spending settings** link. Point at, focus or press the warning to read the policy and advice.

Detection follows a request or a usage poll, which may lag by five minutes: spending can happen before the stop.

Set a hard cap with the provider; for a chain account, disable extra usage or automatic credit reload, or set its monthly limit where supported. Credit availability is not consent to spend.

Actual paid stops and positive-balance sources still need [live checks](../unverified/accounts.md#paid-subscription-usage-stops).

## When Claude Code asks to sign in again

If Claude Code unexpectedly asks you to sign in again, `logs/even-keel.log` records observed changes of its credential file: tokens emptied, renewed or restored, with the file's write time.

An emptying also includes expiry dates, the selected CLI version, live session PIDs and nearby changes in other account folders. Token values are never logged.

The first check after a service restart establishes a baseline and reports already empty tokens once.

Preserve the log before signing in again; it helps investigation but does not determine the cause. See [account diagnostics](../accounts.md#oauth-token-diagnostics-btn-763).
