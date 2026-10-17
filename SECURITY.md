# Security

Even Keel starts Claude Code sessions with `--permission-mode auto`, writes answers into them and signs accounts in and out. Whoever drives its page drives the machine it runs on, so a hole in it matters more than in an ordinary web app.

## Reporting a vulnerability

Report it privately through [GitHub Security Advisories](https://github.com/NamerekT/even-keel/security/advisories/new) of this repository ("Report a vulnerability" on the Security tab). Do not open a public issue for it.

Say what an attacker needs (network position, access to the tracker, a page open in the victim's browser…), what they get, the steps to reproduce, and the Even Keel commit or version, OS and Claude Code CLI version. The fix and the advisory are worked out with you in the advisory before anything is made public.

Only the latest release gets fixes.

## What counts

- Reaching the page or its API past the boundary described in the README ([Reaching the page from another machine](README.md#reaching-the-page-from-another-machine)): around the `Host` and `Origin` checks, the `EVEN_KEEL_TOKEN` check or its cookie, DNS rebinding, cross-site requests from another page in the browser.
- Starting, answering or stopping a session, or changing the config, by someone the page did not let in.
- Leaking secrets: tracker and CI tokens from `.env`, `EVEN_KEEL_TOKEN`, API keys of accounts, the CLI's credentials — into the page, the service log, the statistics database, a tracker comment or the environment of a session.
- Writing or reading files outside the places Even Keel means to: the chat's file upload, the routes that serve files, worktree and slot paths.
- A plugin or hook of this repository (`plugins/`, `tally/bin/`) running something it was not asked to.

## What does not

- What an agent does inside its session under `--permission-mode auto`: that is Claude Code's permission system and your settings and hooks. Vulnerabilities in Claude Code itself go to [Anthropic](https://code.claude.com/docs/en/legal-and-compliance#security-vulnerability-reporting); in Codex — to OpenAI.
- Anyone who can write tasks or comments in the tracker project directs the sessions: the task text is their prompt and a comment can answer their question. Give write access to the project only to people you would let run code on the machine.
- An attacker who already has the machine's user account, the service account or a valid token.
- The page opened over plain HTTP from another machine: the README says the token is then visible on the way.
