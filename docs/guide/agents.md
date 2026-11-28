# Agents

Even Keel runs sessions on four agent CLIs: Claude Code and, in preview, Codex, OpenCode and GitHub Copilot. This page says which CLI version sessions use, how each agent is run and what it lacks next to Claude Code. Signing in and limits are in [Accounts and limits](accounts.md); what each agent reads of a project's rules is in [Sessions](sessions.md#the-projects-instructions-and-skills).

- [What each agent has](#what-each-agent-has)
- [CLI copies](#cli-copies)
- [Claude Code](#claude-code)
- [Codex (preview)](#codex-preview)
- [OpenCode (preview)](#opencode-preview)
- [GitHub Copilot (preview)](#github-copilot-preview)

## What each agent has

An agent is picked in **Settings** → **Providers and models** → **Provider**, for every project or in a project's own settings, or for one task on its card. Click a provider's block or its corner circle to pick it; the arrow keys move between the circles. The model, account and window fields of every block stay editable without picking it. A provider on **Checked** whose copy is missing asks to download it first; cancelling keeps the choice, and the chain waits.

| | Claude Code | Codex | OpenCode | Copilot |
| --- | --- | --- | --- | --- |
| Asks you a question with answer buttons | yes | no | no | no |
| Handoff on a full context | yes | yes | yes | never seen working |
| Your global `~/.claude/CLAUDE.md` and skills | yes | no | no | no |
| Checked as a chain under the service | yes | on short test tasks | on Windows, free models only | no, from a terminal only |

An agent without a question tool ends its turn with the question in its text, and the task waits for your reply in the chat window. Run the preview agents on test tasks first; what was never checked live is in [What has not been verified](../unverified.md).

## CLI copies

Each agent's sessions run either on the CLI you installed or on Even Keel's own copy of a version. The choice is **CLI version** in **Settings** → **Providers and models**, per provider; the list of what Even Keel relies on in each CLI and where the copies come from is in [The CLIs it depends on](clis.md#the-clis-it-depends-on).

| CLI version | Runs on | Downloads | Pick it when |
| --- | --- | --- | --- |
| **Yours** (the default) | the CLI you installed and update | nothing | you keep the CLI current yourself |
| **Checked** | Even Keel's copy of the version it was checked against | once you agree; later checked versions by themselves | you want the version Even Keel was tested on |
| **Latest** | Even Keel's copy of the agent's newest release, looked for every 15 minutes | once you agree; then each new release, next to the current copy | you cannot install the CLI yourself |

- Choosing **Checked** or **Latest** asks for consent with the version and the approximate size; **Cancel** keeps **Yours**. The consent is asked once per provider, and the chain waits for the copy. Nothing else — no start, sign-in or version check — downloads a copy.
- **Latest** appears only where you cannot install the CLI: in [Docker](docker.md#the-agents-clis), or when `npm install -g` cannot write npm's global folder. Claude Code installs into your home folder, so on a host it is always **Yours** or **Checked**. Sessions keep running on the old copy until the new one is complete.
- Blue bands under the header and on the agent card show the download; in the setup, adding an account opens by itself once it ends, since the sign-in goes through the CLI.
- A failed download switches that provider to **Yours** and offers **Try downloading again** — except Claude on the `Agent SDK`, which needs the checked CLI and stays on **Checked** until the retry.

Without a CLI, the agent's card shows the installation command to copy, **Install**, which runs the agent's official installer as the user Even Keel runs as and shows its output, and **Check again**, which looks for a CLI you installed in a terminal. Even Keel never installs a CLI without that press. Where installing is impossible, it offers **Switch to checked** and **Download the latest** instead.

A CLI on a version Even Keel was not checked against is an entry of the event log (**Log** in the header), not a banner; the entry opens the setting.

### Checking a new CLI version

**Check new CLI versions on this machine** (**Settings** → **Providers and models**, off by default) lets Even Keel try a new CLI version itself before you move to it.

When a provider releases a newer CLI than the checked one, and once a week on the checked one, it runs a short live session on a cheap model in the account folder your projects use: launch, a question and its answer, a file written, the hooks, the limits and the stop. It waits until that folder has no live session, and the chains on that account wait while it runs, a few minutes. Each run spends the account's limits.

A banner says whether the version passed or at which step it failed; the service log has the whole run. A pass means that version works on this machine: if your CLI has already updated to it, you can switch that provider to **Yours** before the next Even Keel release checks it.

## Claude Code

### Two ways to run a session

Claude sessions run one of two ways: `CLI --bg`, the CLI's own background sessions, or `Agent SDK`, where Even Keel holds each session's CLI in a small process of its own. Through the SDK:

- a session outlives a restart of the service with its question still open;
- an answer or a chat message goes straight into the running session instead of stopping and resuming it;
- a tool call the auto mode would put to you comes to the page as a question with **Allow** and **Deny**, or is refused at once in unattended mode.

The choice is **Execution** of Claude Code in **Settings** → **Providers and models**: `Auto`, the default, runs an API key account through the SDK and a subscription on `--bg`; `CLI --bg` or `Agent SDK` runs every Claude account that way. Each account's **Runs through** column says which way its sessions go. A change applies to new sessions; running ones keep their way.

The SDK on a subscription is your call, for two reasons:

- Anthropic asks products built on the Agent SDK to sign in with an API key rather than a claude.ai subscription.
- For the same work, the SDK spends the 5-hour limit about twice as fast as `--bg` and the weekly one about a quarter faster, measured by Even Keel over several days of the chain on both ways ([anthropics/claude-code#97074](https://github.com/anthropics/claude-code/issues/97074) is open). An API key account has no such penalty.

The SDK needs the checked CLI: picking `Agent SDK` switches **CLI version** to **Checked** and locks it there. Even Keel downloads the SDK alongside that CLI only after you approve the download, and sessions wait until both copies are ready. With `EVEN_KEEL_CLAUDE_BIN` set, sessions run on `--bg` whatever you pick. How the SDK transport is built is in [docs/sessions/sdk.md](../sessions/sdk.md).

### Settings shared by all accounts

Claude Code settings shared by all accounts live in `~/.claude/settings.json`: change them there. Before each launch in an account folder, Even Keel copies them into that folder's `settings.json`.

A change made right in an account folder's file — by hand or by a CLI command such as `/model` — is not overwritten by the next copy. The account shows a band in **Accounts** with a row per changed setting, what it was and what it is now, and three buttons:

- **Make shared** — the value goes into `~/.claude/settings.json`, and the account follows the shared value again;
- **This account only** — it stays the account's own setting, listed with it in **Accounts**, where × brings the shared value back;
- **Discard** — the shared value comes back.

With several changed settings, the band's head does the same for all of them at once. What Claude Code itself writes into the folder, such as the notification flags of Remote Control, stays there without a band.

An agent that tries to edit an account folder's `settings.json` is refused by a hook Even Keel adds there, and the refusal points it to the global file. The hook keeps your other hooks and applies only in Even Keel's account folders; when Even Keel is unavailable, it lets the edit through and the band picks it up later. Removing Even Keel removes the hook and keeps your settings and hooks.

### Folder trust

Before each background launch or resume, Even Keel marks the project's checkout as trusted in Claude Code for the account the session uses, and its task worktrees inherit that trust. Trust means Claude Code runs the repository's own hooks in chain sessions; the repository's MCP servers stay off, since the chain gives sessions MCP only as [packages](packages.md). The Agent SDK does not write Claude trust.

If saving trust fails, the chain pauses without touching a damaged configuration file, and the pause names the file. Fix it or its write access, then press **Check again and resume**.

If the CLI still refuses folder trust, the pause gives one command that opens the same Claude CLI and account in the checkout, in the shell named over it: as the service user when Even Keel runs as a service (on Windows through `runas`), otherwise as you. Accept the trust dialog, then press **Check again and resume**. On a Windows service the command runs a short PowerShell script Even Keel writes into its state folder, under `trust/`, so you can read what it does first.

## Codex (preview)

**Provider** set to Codex, for the projects or one task, runs the task's sessions on the OpenAI Codex CLI: one `codex exec --json` per turn, the transcript and the context fill read from Codex's own session files, the project's packages passed on every turn.

On Windows, run Codex chains only with **Execution** of Codex set to **Without the sandbox**: from the Windows service the Codex sandbox does not start (a Codex bug), and a session can neither edit files nor run commands. Without the sandbox a session does everything without limits on the machine.

### Folder trust in Codex

Codex applies a folder's [Protection](protection.md) rules only in a project its account trusts, so before each Codex turn Even Keel adds the project's folder as trusted to that account's `config.toml`; task worktrees inside it inherit the trust. This also turns on the project's own `.codex` configuration and hooks. A folder you marked `untrusted` there is left as it is: its sessions then run without those rules, and the service log says so. If the file cannot be read or written, the task does not start and the message names the file.

### Limits and models

Limits — 5-hour and weekly, or the free plan's 30-day one — are read from ChatGPT every five minutes; while a Codex session works, the page follows the limits its session file writes every few seconds, so a heavy model does not run past what the page shows. A seat in a workspace (Team, Business, Edu, Enterprise) also shows the month's credits against the cap its owner set; while the cap is spent, the account is held and its card says so, until the owner raises the cap or the month turns.

If ChatGPT revokes the sign-in before it expires (for example after a plan change), Even Keel asks Codex to renew it once, when the folder has no live session, and reads the limits again without spending the allowance. A failed renewal is not repeated: sign the account in again.

A ChatGPT sign-in runs only the models of its plan, so a model it does not list (the free plan has fewer) is not launched: the chain pauses with a message and a button to the session settings, and goes on by itself once you pick a model the account has. If ChatGPT still refuses a model in a turn, the chain pauses the same way: choose another **Model** or **Account**, change the model on the task's card if it set one, press **New session**, then resume the chain. An API-key account is not checked: it reaches models its list does not name.

Pictures Codex opens show as thumbnails in the session's chat and transcript; click one to browse the session's pictures. They stay there after the files are removed.

## OpenCode (preview)

**Provider** set to OpenCode, or a task's run such as OpenCode with the model `opencode/big-pickle`, runs the task's sessions on [OpenCode](https://opencode.ai): one `opencode run` per turn, the transcript and the context fill read from OpenCode's own database, the project's packages passed on every turn.

The model is OpenCode's `<provider>/<model>` (`opencode/big-pickle`, `anthropic/claude-sonnet-4-5`, `openai/gpt-6.1-sol`); without one, OpenCode's default. A model the account's `opencode models` does not list is not launched: the chain pauses with a message and a button to the session settings, and goes on by itself once you pick a model the account has. For a ChatGPT sign-in, the OpenAI models are also checked against the subscription's own list, and a later refusal pauses the chain as [on Codex](#limits-and-models).

The session reads the project's `AGENTS.md`, else its `CLAUDE.md`, and its skills ([the project's instructions and skills](sessions.md#the-projects-instructions-and-skills)). Even Keel's [agent-bridge](../../plugins/agent-bridge) plugin reaches it through an OpenCode plugin of its own: the handoff on a full context, chat messages delivered after the session's next tool call, and the check before the merge. An error a turn ends on (a provider refusing, a server error) shows as an error line in the chat.

Limits come from what you sign it in with:

- a ChatGPT sign-in — its 5-hour and weekly windows, shared with a Codex account on the same subscription (the cards say so);
- a Copilot sign-in — its monthly allowance;
- an OpenCode Go subscription key — its three windows;
- the free models and other API keys — none, and the card says why. It shows instead the tokens the account used today and over 30 days (with Tally on) and when it was last refused. When the chain hits a limit with no known reset, it tries again in 15 minutes, then waits longer each time, up to 4 hours.

Pictures OpenCode tools return, images read from a file included, show as thumbnails beside the tool call in the chat and the transcript, and stay there after the files or the worktree are removed.

## GitHub Copilot (preview)

**Provider** set to Copilot, or a task's run such as Copilot with the model `gpt-6-luna` (no model leaves it to Copilot's `auto`), runs the task's sessions on the [GitHub Copilot CLI](https://github.com/github/copilot-cli): one `copilot -p` per turn, the transcript and the context fill read from Copilot's own session files, the project's packages passed on every turn.

The session reads the project's `CLAUDE.md` and `AGENTS.md`, both when both are there, and its skills ([the project's instructions and skills](sessions.md#the-projects-instructions-and-skills)).

Do not count on the handoff on a full context or on chat messages reaching a Copilot session mid-turn: both need Copilot to run Claude Code hooks, which was never seen working. Without them, your message waits for the turn's end.

If Copilot rejects an unavailable model before the session starts, the session shows the reason and a button to the project's session settings. Choose an available **Model** there (or change the model on the task's card), then press **New session**; Even Keel does not switch models by itself.
