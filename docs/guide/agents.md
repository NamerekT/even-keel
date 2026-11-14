# Agents

Even Keel runs sessions on four agent CLIs: Claude Code and, in preview, Codex, OpenCode and GitHub Copilot. This page says which CLI version sessions use, how each agent is run and what it lacks next to Claude Code. Signing in and limits are in [Accounts and limits](accounts.md); what each agent reads of a project's rules is in [Sessions](sessions.md#the-projects-instructions-and-skills).

- [CLI copies](#cli-copies)
- [Claude Code](#claude-code)
- [Codex (preview)](#codex-preview)
- [OpenCode (preview)](#opencode-preview)
- [GitHub Copilot (preview)](#github-copilot-preview)
- [A turn's process](#a-turns-process)

## CLI copies

Each agent's sessions run either on the CLI you installed or on Even Keel's own copy of the version it was checked against. The choice is per provider; the list of what Even Keel relies on in each CLI is in [setup](setup.md#the-clis-it-depends-on).

**CLI version → Yours**, the default, uses the CLI you manage; nothing is downloaded.

**Checked** runs sessions on Even Keel's own copy of the version it was checked against: choosing it in the setup or in settings (the log's entry of an unchecked version opens them) asks for consent with the version and approximate size, and the chain waits for the copy.

In settings the CLI version is saved with the rest of the form, Execution included, and the consent comes after the save.

Blue progress bands under the header and on the agent card show downloaded bytes.

A failed download switches that provider to Yours and offers a retry; without a CLI, the agent shows a copyable installation command and **Check again**.

See [setup](setup.md#the-clis-it-depends-on).

During first-run setup, CLI downloads and sign-in state appear on the agent cards. Usage limit warnings appear after setup; a CLI on a version Even Keel was not checked against is an entry of the event log (**Log** in the header), not a banner.

### Checking a new CLI version

**Check new CLI versions on this machine** (Settings → Providers and models, off by default) lets Even Keel try a new CLI version itself before you move to it.

When a provider releases a newer CLI than the checked one, and once a week on the checked one, it runs a short live session on a cheap model in the account folder your projects use: launch, a question and its answer, a file written, the hooks, the limits and the stop.

It waits until that folder has no live session, and the chains on that account wait while it runs, a few minutes.

A banner says whether the version passed or at which step it failed; the service log has the whole run.

A pass means that version works on this machine, a reason to switch that provider to Yours if you want it before the next Even Keel release.

Each run spends the account's limits.

## Claude Code

### Two ways to run a session

Claude sessions run one of two ways: `CLI --bg`, the CLI's own background sessions, or `Agent SDK`, where Even Keel holds each session's CLI in a small process of its own.

Through the SDK a session outlives a restart of the service with its question still open, and an answer or a chat message goes straight into the running session instead of stopping and resuming it.

A tool call the auto mode would put to you comes to the page as a question with "Allow" and "Deny" and waits for your answer, or is refused at once in unattended mode.

Which one is Claude Code's "Execution" in Settings → Providers and models: `Auto`, the default, runs an API key account through the SDK and a subscription on `--bg`; `CLI --bg` or `Agent SDK` runs every Claude account that way.

Each account's Runs through column says which way its sessions go.

If you had picked the way per account before the update, the setting takes it over when every account agrees with `Auto` or every one was on the SDK; otherwise it is `Auto`, and the service log names each account whose way changed.

Anthropic asks products built on the Agent SDK to sign in with an API key rather than a claude.ai subscription, so the SDK on a subscription is your call.

It also costs more of the subscription's limits: for the same work the SDK spends the 5-hour limit about twice as fast as `--bg` and the weekly one about a quarter faster, measured by Even Keel over several days of the chain on both ways ([anthropics/claude-code#97074](https://github.com/anthropics/claude-code/issues/97074) is open); an API key account has no such penalty ([docs/sessions/sdk.md](../sessions/sdk.md#agent-sdk-against---bg-measured-btn-286-btn-388)).

The SDK needs the checked CLI (the "CLI version" next to it). Even Keel downloads the SDK alongside that CLI only after you approve the download; Checked sessions wait until both copies are ready.

A change applies to new sessions, running ones keep their way ([docs/sessions/sdk.md](../sessions/sdk.md#the-agent-sdk-transport-btn-239-srcclaudesdk)).

### Settings shared by all accounts

Claude Code settings shared by all accounts live in `~/.claude/settings.json`: change them there. Before each launch in an account folder, Even Keel copies them into that folder's `settings.json`.

A change made right in an account folder's file — by hand or by a CLI command such as `/model` — is kept, not overwritten: the account shows a band in **Accounts** with **Make shared**, **Keep for this account only** and **Discard**.

An account's own settings are listed with it in **Accounts**, where × brings the shared value back, and survive later transfers.

An agent that tries to edit an account folder's `settings.json` is refused by a hook Even Keel adds there, and the refusal points it to the global file.

The hook preserves your other hooks and applies only in managed Claude account folders. Other files and the global settings file remain editable.

When Even Keel is unavailable, the hook lets the edit proceed; the settings-change band can handle it later.

Removing Even Keel removes its hook and keeps your settings and hooks. [Real CLI and platform checks are still pending](../unverified/accounts.md#account-settings-edit-hook-btn-902).

### Folder trust

Even Keel automatically marks the project's checkout as trusted in Claude Code before each background launch or resume, using the selected account. This also enables repository hooks; the chain disables repository MCP servers. The Agent SDK and other agents do not write Claude trust.

If saving trust fails, the chain pauses without replacing a damaged configuration file; the pause names the file. Fix it or its write access, then press **Check again and resume**.

If the CLI still refuses folder trust, the pause gives one command that opens the same Claude CLI and account in the checkout — as the service user when Even Keel runs as a service (on Windows through `runas`), otherwise as you — in the shell named over it. Accept the trust dialog, then press **Check again and resume**; the retry saves trust again.

On a Windows service the command runs a short PowerShell script Even Keel writes into its state folder, under `trust/`, so you can open it and read what it does.

Saved pauses from older versions retain their original commands using `claude` from PATH, both of them when the pause does not know whether Even Keel runs as a service; check the CLI and account yourself or retry to get fresh commands.

### Stale session records

For Claude background sessions, Even Keel checks process creation times to discard stale session records and leave another process that reused a session's or saved child's process number running. If the operating system cannot report a creation time, it keeps the previous process-number check.

## Codex (preview)

The shared or a project's `provider` key (the shared one is also moved by giving the Even Keel role to the Codex account on the accounts page), or Codex picked on a task's card, runs the task's sessions on the OpenAI Codex CLI instead: one `codex exec --json` per turn, the transcript and context fill read from Codex's own session files, the project's packages passed on every turn.

Limits (5-hour and weekly, or the free plan's 30-day one) are read from ChatGPT every five minutes, sharing a request with OpenCode on the same subscription; if the request fails, the latest limits in Codex's session files stand in.

If ChatGPT revokes the sign-in before it expires (for example after a plan change), Even Keel asks Codex to renew it once and reads the limits again, without a model turn or spending the allowance.

This waits until the folder has no live Even Keel sessions, including those between turns. A failed renewal is not repeated on every poll; renew the account's sign-in if needed.

Codex has no question tool, so a turn that ends without the task done waits for your reply in the chat window.

Run it as a chain only on short test tasks. From the Windows service the Codex sandbox does not start (a Codex bug), so on Windows it needs `execution.codex` set to `bypass`, which runs Codex sessions with no sandbox at all ([What has not been verified](../unverified/codex.md)).

Pictures Codex opens with `view_image`, including several returned by one tool call, appear as thumbnails in the session's chat and whole transcript. Click one to open the viewer and browse the session's pictures. They remain available from the transcript after the original files are removed.

## OpenCode (preview)

`provider` set to `opencode`, or a task's run such as OpenCode with the model `opencode/big-pickle`, runs the task's sessions on [OpenCode](https://opencode.ai): one `opencode run` per turn, the transcript and context fill read from OpenCode's own database, the project's packages passed on every turn.

The model is OpenCode's `<provider>/<model>` (`opencode/big-pickle`, `anthropic/claude-sonnet-4-5`, `openai/gpt-6.1-sol`); without one, OpenCode's default.

A model the account's `opencode models` does not list is not launched: the chain pauses with a message and a button to the session settings, and goes on by itself once you pick a model the account has.

An error a turn ends on (a provider refusing, a server error) shows as an error line in the chat.

The session reads the project's `AGENTS.md`, else its `CLAUDE.md`, and its skills ([the project's instructions and skills](sessions.md#the-projects-instructions-and-skills)), but not your global `~/.claude/CLAUDE.md` or skills.

Like Codex, it has no question tool: a turn that ends without the task done waits for your reply in the chat window.

A turn that has written nothing for 30 minutes while its process lives on is taken for hung: the session shows as waiting with a note, and a message to it or "New session" stops the turn first; nothing stops it on its own.

The [agent-bridge](../../plugins/agent-bridge) plugin reaches it through an OpenCode plugin of its own: the handoff on a full context, chat messages delivered mid-turn, after the session's next tool call, and the check before the merge.

Limits come from the provider you sign it in with: a ChatGPT sign-in shows its 5-hour and weekly windows (shared with a Codex account on the same ChatGPT subscription, and the cards say so), a Copilot one its monthly allowance, and a Go key its three windows.

The free models and other API keys have none, and the card says why.

An account on the free models shows instead the tokens it used today and over 30 days (with Tally on) and when it was last refused by its limit; when the chain hits a limit with no known reset, it tries again in 15 minutes, then waits longer each time it is refused again, up to 4 hours.

It was checked as a chain under the Windows service on the free models only; a Go, ChatGPT, Copilot or API-key account and Linux or macOS were never run ([What has not been verified](../unverified/opencode.md)): run them on test tasks first.

### Models of a ChatGPT sign-in

For ChatGPT sign-ins, the offered OpenAI models are also checked against the subscription's visible model list. Models absent from OpenCode stay unavailable even if ChatGPT lists them. If that check cannot be read, the ordinary OpenCode catalogue remains available.

A later ChatGPT model refusal pauses the chain with a button to the session settings: choose another **Model** or **Account**, change the model on the task's card if it set one, use **New session**, then resume the chain. Other providers and API-key accounts keep their ordinary lists.

Pictures returned by OpenCode tools, including images read from a file, appear as thumbnails beside the tool call in the session's chat and whole transcript. Click one to browse the transcript's pictures. They are read from OpenCode's database and remain available after the original files or worktree are removed.

## GitHub Copilot (preview)

`provider` set to `copilot`, or a task's run such as Copilot with the model `gpt-6-luna` (Copilot with no model leaves it to Copilot's `auto`), runs the task's sessions on the [GitHub Copilot CLI](https://github.com/github/copilot-cli): one `copilot -p` per turn, the transcript and context fill read from Copilot's own session files, the project's packages passed on every turn.

The session reads the project's `CLAUDE.md` and `AGENTS.md`, both when both are there, and its skills ([the project's instructions and skills](sessions.md#the-projects-instructions-and-skills)), not your global `~/.claude/CLAUDE.md` or skills.

Like Codex, it has no question tool: a turn that ends without the task done waits for your reply in the chat window.

What it does not have yet: the handoff on a full context and chat messages delivered mid-turn rest on Copilot running Claude Code hooks, which was never seen.

It was checked from a terminal only, never as a chain under the service ([What has not been verified](../unverified/copilot.md)): run it on test tasks first.

If Copilot rejects an unavailable model before starting a normal transcript, the session shows the reason and a button to the project's session settings. Choose an available Model there (or change the model on the task's card), then choose **New session**. Even Keel does not switch models automatically.

## A turn's process

For Codex, OpenCode and Copilot, Even Keel checks whether a turn's process number was reused by a newer process. The session then waits for your reply, and stopping it leaves the newer process running.

A completed turn is also recognised when the CLI prints diagnostic lines after its final event. If the operating system cannot report the process creation time, process checks follow the previous behaviour.
