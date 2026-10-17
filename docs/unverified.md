# What has not been verified

Even Keel is checked live on the author's machine with the author's accounts. Some behaviour could not be checked there: the situation never came up, or there was no way to create it. This page lists it, so you know where Even Keel works on an assumption. Each entry says what is assumed, what happens if the assumption is wrong and what to do about it.

If you run into one of these, please open an issue with what you saw: it is the only way the entry gets checked.

## Platforms

- **macOS.** `service/install.sh` installs a launchd agent there, but Even Keel has never run on a Mac: neither the agent nor finding the CLI and its folders.

## Updating

- **Plugins from a git URL marketplace.** A marketplace added from a local path is read from its folder, so an update of the code reaches the plugins by itself; that was checked. One added from a git URL (`owner/repo`, `https://…`) keeps a copy by version, and README tells you to run `claude plugin marketplace update even-keel` and `claude plugin update <plugin>@even-keel` in each project. The commands were run, but a copy that is actually behind was never brought up to date with them. If sessions still run the old plugin, `claude plugin uninstall … --scope project` and `claude plugin install … --scope project` in the project install the current one.

## Claude limits

- **An early reset of a limit.** Anthropic sometimes resets a five-hour window or all limits of an account ahead of time. When a session hits a limit, the chain remembers the reset time from the error or from `/usage` and waits for it; what `/usage` shows right after an early reset has never been seen. If it shows a new window or no window, the remembered time is not updated and the chain keeps waiting until the original reset. **Workaround:** press "New session" on the task — it drops the remembered wait and starts a session at once; or switch the account.
- **Continuing a session after a limit.** A limit cannot be hit on demand, so neither path the chain takes after one has run live: `--resume` while the cache is warm and a new session with a handoff when it is cold (`docs/chain.md`, exception 1). Each shares its mechanics with paths that were checked on 17.10.2026: the resume with the user's answer from the page (`cli.resume`), the handoff with a checkpoint and "New session" (`relay`). What is left unchecked is the decision itself — reading the reset time, choosing warm or cold, the moment of the step. If the chain keeps waiting after the limit has reset, or resumes a session that then fails, **workaround:** press "New session" on the task.
- **Fast mode in statistics.** Responses in fast mode are recorded (`speed = fast`), but none have appeared in the data, so `/stats` prices them as normal responses and their cost is understated (`tally/CLAUDE.md`).

## Sessions

- **`--resume` after an unanswered question.** When a question (`AskUserQuestion`) did reach the transcript and the session is resumed with an answer, how the CLI treats the call left without a result was seen only in an Agent SDK session (CLI 2.1.302, BTN-136): the call gets a synthetic error result "Tool call interrupted" and an assistant "No response requested.", and the next prompt answers it; `claude --bg --resume` is assumed to do the same. The reply prompt repeats the questions and answers in plain text, so it does not depend on it (`docs/sessions.md`).
- **A tracker MCP server cached as failed.** The format of `mcp-needs-auth-cache.json` and the 15 minutes were read from CLI 2.1.302 and an entry was written live with a failing plugin server, but a chain launch held by it and started after the wait was never seen; the skip itself was seen in a session of the BTN-143 trial. Even Keel does not compare the entry's `id` with the server's config: after an edit of the plugin's `.mcp.json` the CLI would retry at once, yet the chain still waits out the 15 minutes. If the CLI changes the file or its keys, the chain launches as before and the session reports the server did not connect. **Workaround:** delete the server's entry from `<account folder>/mcp-needs-auth-cache.json` — the next check launches the task (`docs/sessions.md`).
- **Environment variables through the daemon.** A variable set for the `claude --bg` that starts the daemon reached the session (`ANTHROPIC_API_KEY`, BTN-136), but through a daemon that is already running, and in a session the daemon respawns (its job keeps only `CLAUDE_CONFIG_DIR`), it was not checked, so Even Keel does not pass anything that way (`docs/sessions.md`).
- **A chain session on an API account.** The CLI was seen to take a key from the account folder's `settings.json` (`claude auth status` says `api_key`, BTN-99) and a `--bg` session was seen to work on a key passed in its environment (BTN-136), but a chain session started from an API account folder with a real key was not run. If the daemon or a respawned session does not pick the key up, the session fails at its first request with an authentication error and stops like any error. **Workaround:** set the key in that folder with `apiKeyHelper` or run the chain on a subscription account (`docs/accounts.md`).
- **The 1-hour cache on a key.** `cacheTtl: "1h"` goes to sessions as `promptCacheTtl`, which the CLI 2.1.302 binary honours whatever the sign-in; that a session on a key then really writes the 1-hour cache (`ephemeral_1h_input_tokens` in the transcript) was not checked with a real key. If it does not, sessions on a key keep the 5-minute cache and `/stats` shows more cache writes than expected; nothing breaks (`docs/sessions.md`).
- **An API key out of credit.** What the transcript says when the key's organization runs out of credit was never seen. Such a session stops like any other error and waits for the user (invariant 1); nothing resumes it after a top-up (planned in BTN-165). **Workaround:** top up and press "New session" on the task, or answer the session from the chat window.

## Trackers

- **GitHub attachments.** Downloading a file attached to an issue or comment with the token has not been tried live; if it fails, the page cannot open that file (`docs/trackers.md`).
- **Milestones on GitHub and Linear.** Filling the milestone of a task that entered the chain without one (`fillMilestone`) was checked only on Huly (`docs/trackers.md`).

## CI

- **When a CI run counts as stuck.** A queued run, or a push without a run, is called stuck after 2 minutes (`STUCK_MS`). The figure was chosen without live runs and may be too short for a slow runner queue (`docs/ci.md`).
- **A command after a green main that restarts Even Keel.** `commands.afterGreen` run as children of the service's node process. The service stops only that process, not its tree — the Windows wrapper (`service/EvenKeelService.cs`, `OnStop`), `KillMode=process` under systemd, `AbandonProcessGroup` under launchd — so a restart command is expected to outlive the stop and start the service again, but that was never run live. If it dies with the service, the service stays stopped, or the commands after the restart one never run. **Workaround:** make the restart the last command, hand it to something outside the service's process tree (a scheduled task, `systemd-run`), or restart by hand (`docs/ci.md`).
