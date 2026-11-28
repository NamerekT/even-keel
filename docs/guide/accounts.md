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

What each agent can sign in with:

| Agent | Sign-ins |
| --- | --- |
| Claude Code | a Claude subscription, an Anthropic API key, a cloud (Amazon Bedrock, Google Vertex AI, Microsoft Foundry) |
| Codex | a ChatGPT subscription, an OpenAI API key |
| OpenCode | ChatGPT, an OpenCode Go key, an Anthropic, OpenAI or OpenRouter API key, OpenCode's free models |
| Copilot | the machine's GitHub sign-in, a token |

Accounts appear only after you add them: installing a CLI or signing in to it does not add one. **Add account** is on the setup's Agent step, on the accounts page (at the top, or a provider's own **Add**) and in the project wizard. A provider whose CLI is missing is greyed, with help to install it.

1. Choose the provider.
2. If its CLI — Claude Code or Codex in its usual folder — already has a sign-in on this machine, pick **Use this sign-in**, or **Sign in with another account** to keep a separate folder.
3. Follow the sign-in steps. The dialog closes on success and highlights the added row.

The first account you add for a provider is the one Even Keel runs that provider's sessions on, until you pick another. Removing an account that uses the CLI's own sign-in keeps that folder and its sign-in.

An account goes by its given name, else its e-mail, else the provider (numbered for duplicates); **Rename** in the row's menu changes only that name, and an empty name brings the default back.

## Subscriptions

Your own subscriptions — a personal and a work one, say — one folder each.

### Claude: a full sign-in or a long token

A Claude subscription signs in one of two ways, picked in the add dialog:

| | Full sign-in | Long token |
| --- | --- | --- |
| How | Claude Code's own: a link, the sign-in and a code | the token `claude setup-token` issues, pasted into the dialog |
| Lives | about 30 days, not extended by use | a year |
| Limits | read every five minutes, each model's week too; an early reset is seen at once | only while a session of the account runs, without a model's own week; a chain waits for the reset time it was told |
| E-mail on the page | yes | no |
| Remote Control | yes | no |

**Full sign-in.** In a browser of the computer Even Keel runs on, **On this computer** signs in with no code; **From another device** is the link and the code, as on a phone. The sign-in may end any moment in its last three days, so the page counts the days left to the start of that window, offers **Renew** in the week before and warns a day before it. It has also dropped on its own after a reboot or a night with Even Keel off: the account then asks you to sign in again.

**Long token.** Run `claude setup-token` in a terminal on any machine with Claude Code, sign in with the account you need and paste the token; one short turn checks it before the account is added. The account's row says "long token" and its last day; a month before it, the row says the token ends soon. A refused or outdated token asks for a new one: **Issue a new token** puts it into the same folder, with the account's name and uses kept. Whether a token really lasts its year has not been checked yet.

Take the full sign-in when you watch the limits or use Remote Control; take the token for a machine left alone for weeks, where a dropped sign-in would stop the chain with nobody there. When the token belongs to an account already added with a full sign-in, pick it in **The same account as**: the token account then shows that account's limits and resets, and only Remote Control is missing. How a machine of a hub gets the hub's token is in [Accounts on a machine](hub-machine.md#a-long-token-on-a-machine).

### Codex and OpenCode on ChatGPT

At most one ChatGPT account may be on the free plan across Codex and OpenCode: Even Keel refuses a different second free account and holds any already added. The same e-mail may be used in both agents, sharing its allowance. Paid plans have no limit on the number of accounts. A plan Even Keel cannot read stays unknown; it is never taken for free.

### OpenCode

OpenCode accounts are folders of their own too: signed in with ChatGPT (a link and a one-time code), on an API key, on an OpenCode Go key, or with no sign-in for OpenCode's free models. There is no Claude subscription for OpenCode: Anthropic allows it only in Claude Code, so Claude in OpenCode is an Anthropic API key.

**An API key** may be Anthropic's (`sk-ant-…`), OpenAI's or OpenRouter's (`sk-or-…`), told apart by its start, and is checked with that provider when added and then hourly. On an OpenRouter key, a project's or a task's model can be any of OpenRouter's, like `openrouter/minimax/minimax-m3.1-flash`. The account's row shows **Balance**, and **Key limit left** if you set a spending limit on the key in OpenRouter. Should OpenRouter stop telling the balance to an ordinary key, the tip says so: create a management key in OpenRouter's settings and add it with **Management key** in the row's menu. Even Keel keeps it in its own state, never in the account folder, so sessions never see it, and uses it only for **Balance**.

**OpenCode Go.** Choose **Add account** → **OpenCode** → **OpenCode Go** and enter the key from OpenCode Console. The page shows its 5-hour, weekly and monthly windows, refreshed every five minutes, and when a refusal names a reset such as "in 5 days 10 hours", the chain waits for that time. A Console key without Go runs on OpenCode Zen, OpenCode's pay-as-you-go models. If the key expires or is revoked, create a new one in OpenCode Console and choose **Replace key** beside the warning or in the row's menu; signing in again does not renew it.

**GitHub Copilot through OpenCode is not supported yet**: use the [Copilot CLI](#github-copilot) instead. If a saved model or a task's run picks Copilot in OpenCode, the chain pauses with a link to the session settings: choose another **Model** or **Account**, and change the run on the task's card, before resuming.

An OpenRouter key, its balance and the Go windows have [not been checked live yet](../unverified/opencode.md).

### GitHub Copilot

GitHub Copilot accounts are folders too. One runs on the GitHub sign-in already on the machine (`copilot login`, which Copilot keeps for the whole machine, not per folder); for several GitHub accounts, add each with a fine-grained token that has the **Copilot Requests** permission. GitHub's terms allow one free account per person: several tokens are for several paid seats, not to stretch a free budget.

The card shows the monthly allowance, "N left, resets on the 1st", and a spent one waits for the 1st:

- an account on a token shows it when the token also has the **Plan** read permission; without it, the card can count only what was spent, or nothing;
- the machine's sign-in shows it when Copilot uses GitHub CLI's sign-in; otherwise add an account with its own token to read it.

When GitHub gives no numbers, the card says no data is available: look at GitHub's billing page. Paid-plan readings have [not been checked live yet](../unverified/copilot.md).

## API keys

An account can be an Anthropic API key for Claude Code or an OpenAI API key for Codex, checked with the provider when added and then hourly. Its sessions pay from the key, the page shows its spend today instead of usage windows (with statistics on), and it has no Remote Control.

- **Out of credit.** A session whose key runs out of money is held, the key is checked every 5 minutes, and the chain goes on once it is topped up.
- **A spending cap** holds the current task too, OpenCode on an Anthropic key included. The account's problem band and the session panel show the reset date from the error (UTC); the chain retries then, or sooner once you raise the cap. To go on at once, switch the account.
- **A revoked or expired key.** The card says it is not accepted: **Replace key** there or in the row's ⋯ menu takes a new one into the same account, so its name, roles and history stay. The new key is checked first and the old one stays if it is refused; a key of another organization is refused too, since it is another account to add on its own. Sessions already running finish on the old key, new ones start on the new one. A Copilot token is replaced the same way.

## Claude on a cloud

A Claude Code account can run on Claude models in your own cloud account instead of a subscription or an Anthropic key: **Add account** → **Cloud**, then the cloud. The cloud bills it. None of the three has run a live session yet ([What has not been verified](../unverified/accounts.md)): try them on test tasks first.

What the three have in common:

- One short turn checks the connection before the account is added; a refusal says why and adds nothing.
- Like an API key, the account has no usage windows (the page shows its spend and region), runs through the Agent SDK under `Auto` and has no Remote Control.
- The cloud's throttling or quota refusal stops a session like any error, not like a limit.
- Credentials that expire within hours stop a chain left alone overnight; the dialog warns about them.
- Credentials taken from the user Even Keel runs as: under a Windows service that may not be you, so sign in to the cloud's CLI as that user.

### Amazon Bedrock

The credentials, one of:

- an AWS profile, suggested from the AWS files of the user Even Keel runs as (`aws sso login` or `aws configure` as that user);
- a Bedrock API key;
- an access key pair;
- the environment Even Keel already runs with.

Optionally the region, the models (an inference profile id like `us.anthropic.…` or its ARN) and the inference profile prefix. SSO profiles, short-term Bedrock API keys and keys with a session token expire within hours; a profile with a long-lived key or a long-term API key keeps going. Bedrock has no web search, so WebSearch does not work in its sessions.

### Google Vertex AI

Before you start: enable the models in Model Garden, and give the Google Cloud project a paid billing account, since trial credits do not pay for Claude. A new project's Claude quota is often zero: raise it in Cloud Quotas.

The credentials, one of:

- the sign-in `gcloud auth application-default login` leaves for the user Even Keel runs as (the dialog says whether that user has it, and gives the command if not);
- the path to a service account's JSON key, or a Workload Identity Federation config;
- the environment Even Keel already runs with.

Then the project ID (suggested from that user's gcloud configurations) and optionally the region (`us-east5` by default; `global`, `us` or `eu` recommended), the models (a Vertex id like `claude-sonnet-4-5@20250929`) and a region of its own for a model the account's region does not serve. A user's gcloud sign-in may ask for a new sign-in under the organization's session policy: for unattended work, use a service account's key.

### Microsoft Foundry

Before you start: deploy the models in the Foundry portal. Claude needs a pay-as-you-go Azure subscription with Marketplace access (not a free trial, student, credit or CSP one) and a resource in a region that serves it, such as East US 2 or Sweden Central.

The resource, as its name (`my-resource`) or its full address (`https://my-resource.services.ai.azure.com/anthropic`), and the sign-in, one of:

- the resource's API key;
- Microsoft Entra ID: `az login` of the user Even Keel runs as, a service principal in Even Keel's environment or the machine's managed identity (the dialog says whether that user is signed in, and gives the command if not);
- a Bearer token, which lives about an hour and is not renewed: for unattended work, use a key or Entra ID.

Then the deployment names for Opus, Sonnet and Haiku, at least one, exactly as the portal shows them.

## The accounts page

**Accounts** in the header opens a panel; the `/accounts` page shows the same in full. Accounts are grouped by provider, those at work first. Each row has the account's name, its roles, its limits and its live sessions, and problems appear above the list with their fix; tips tell where a limit is shared and how old a reading is.

A role is an app that runs on the account: **Even Keel** for the chain's sessions of that provider, **VS Code** for the Claude Code extension in VS Code. Click the row (or focus it and press Enter) for its menu: move Even Keel or VS Code onto the account, rename it or remove it; an action that cannot be done says why. VS Code picks up the new account after **Developer: Reload Window**, and the move waits while a Claude chat is open there. The Claude desktop app is pointed at an account folder by hand.

The **Machines** column names every other machine of a [hub](hub-machine.md#accounts-on-a-machine) the account is on, each label opening that machine's page; an amber label with a dashed edge is a machine where the account was signed out — press it to sign in there again.

On a phone, a row keeps the name, the role and the tightest used percentage of the plan's windows (with the model's name when the account also has a model's own week); tapping the row opens its menu, whose head shows every window with its reset. The menu button of the header has one **Accounts** button with that percentage and an error dot.

### The account chip in the header

On a project's chain page, the header chip shows the account of its current session, or of the next task before it starts, also while the chain is paused or stopped. Other pages show Even Keel's shared account. Pressing the chip opens the Accounts panel.

Pointing at it shows the accounts that decide the next task's account, up to three: the task's own, the project's and the shared one. When the task or the project has an account of its own over the shared one, the chip gets a coloured border and the number of accounts in play. On a phone, the header shows the account's windows as thin bars along its bottom edge.

## Limits

The windows of every subscription account are read every 5 minutes:

- Claude Code's 5-hour and weekly windows, with its own `/usage` command (no quota spent); a plan with only one of them shows the one it has. Between reads, a Claude session through the Agent SDK keeps them fresh with what the CLI reports at each response.
- A Claude plan's weekly limit of its own for one model (Max, Ultra and Team have one for Fable) — one more meter in the row, named by the model. While that week is used up, a task on that model waits for it, and a task on another model goes on.
- Codex's and OpenCode's ChatGPT windows, from ChatGPT; Copilot's monthly allowance, from GitHub.

Even Keel stays inside them: while a window is used up, the next task waits for its reset. A usage warning names each account it touches, those of other providers included; an account that needs a sign-in says so on its card instead. What happens to a session that hits a limit is in [Handoffs](sessions.md#on-a-usage-limit).

## Subscription credits and extra usage

Some plans let work go on past the included limit for money: usage credits, extra usage, paid requests. Even Keel shows what the provider reports and stops a chain session once it sees paid usage, so a chain does not spend money you did not mean to spend.

- **Extra usage**, a column of the wide accounts page, shows the provider's credit balance, whether extra usage is allowed, or Copilot's paid usage; a dash means the provider does not say. ChatGPT balances are usage credits, not dollars.
- An amber **on credits** chip beside an account's name means a working session seems to be spending paid usage; its tip says why Even Keel thinks so.
- The chain session on such an account is stopped, mid-turn or on a paused chain too. The task keeps its folder, branch and context and goes on when the allowance resets or another account is free. Detection can lag by up to five minutes, so some spending can happen before the stop.
- An account that may spend shows a warning with **Provider spending settings**.

Availability of credits is not consent to spend: for a chain account, turn off extra usage or automatic credit reload at the provider, or set a monthly limit where it has one. Real paid stops have [not been checked live yet](../unverified/accounts.md#paid-subscription-usage-stops).

## When Claude Code asks to sign in again

If Claude Code unexpectedly asks you to sign in again, save `logs/even-keel.log` before signing in and attach it to a [bug report](https://github.com/NamerekT/even-keel/issues): it records the changes of the account's credential file, never the tokens themselves.
