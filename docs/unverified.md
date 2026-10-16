# What has not been verified

Even Keel is checked live on the author's machine with the author's accounts. Some behaviour could not be checked there: the situation never came up, or there was no way to create it. This page lists it, so you know where Even Keel works on an assumption. Each entry says what is assumed, what happens if the assumption is wrong and what to do about it.

If you run into one of these, please open an issue with what you saw: it is the only way the entry gets checked.

## Platforms

- **macOS.** `service/install.sh` installs a launchd agent there, but Even Keel has never run on a Mac: neither the agent nor finding the CLI and its folders.
## Updating

- **Plugins from a git URL marketplace.** A marketplace added from a local path is read from its folder, so an update of the code reaches the plugins by itself; that was checked. One added from a git URL (`owner/repo`, `https://…`) keeps a copy by version, and README tells you to run `claude plugin marketplace update even-keel` and `claude plugin update <plugin>@even-keel` in each project. The commands were run, but a copy that is actually behind was never brought up to date with them. If sessions still run the old plugin, `claude plugin uninstall … --scope project` and `claude plugin install … --scope project` in the project install the current one.

## Claude limits

- **An early reset of a limit.** Anthropic sometimes resets a five-hour window or all limits of an account ahead of time. When a session hits a limit, the chain remembers the reset time from the error or from `/usage` and waits for it; what `/usage` shows right after an early reset has never been seen. If it shows a new window or no window, the remembered time is not updated and the chain keeps waiting until the original reset. **Workaround:** press "New session" on the task — it drops the remembered wait and starts a session at once; or switch the account.
- **Fast mode in statistics.** Responses in fast mode are recorded (`speed = fast`), but none have appeared in the data, so `/stats` prices them as normal responses and their cost is understated (`tally/CLAUDE.md`).

## Sessions

- **`--resume` after an unanswered question.** When a question (`AskUserQuestion`) did reach the transcript and the session is resumed with an answer, how the CLI treats the call left without a result is not known. The reply prompt repeats the questions and answers in plain text, so it does not depend on it (`docs/sessions.md`).
- **Environment variables through the daemon.** Whether variables set for `claude --bg` reach the session through the background daemon was not checked, so Even Keel does not pass anything that way (`docs/sessions.md`).

## Trackers

- **GitHub attachments.** Downloading a file attached to an issue or comment with the token has not been tried live; if it fails, the page cannot open that file (`docs/trackers.md`).
- **Milestones on GitHub and Linear.** Filling the milestone of a task that entered the chain without one (`fillMilestone`) was checked only on Huly (`docs/trackers.md`).

## CI

- **When a CI run counts as stuck.** A queued run, or a push without a run, is called stuck after 2 minutes (`STUCK_MS`). The figure was chosen without live runs and may be too short for a slow runner queue (`docs/ci.md`).
