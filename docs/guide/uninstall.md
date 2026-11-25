# Uninstall

Remove the service — besides it, only the hook Even Keel added to the `settings.json` of its Claude account folders goes:

```sh
even-keel uninstall
```

From a clone, on Windows:

```sh
node dist/src/cli.js uninstall
```

On Linux and macOS:

```sh
service/uninstall.sh
```

On Windows it removes the start at sign-in with its host, and the Windows service too if there is one; that part needs PowerShell 7 as administrator (a clone: `service\uninstall.ps1`).

Sessions it started keep running: they belong to the CLI's daemon, so finish or stop them first (`claude agents` lists them). The rest stays where it is, for you to remove by hand.

**Installed with npm:** the package, then the data folder ([above](service.md#installed-with-npm)), which holds everything listed for a clone's folder below.

```sh
npm uninstall --global even-keel
```

**A clone:** delete its folder. It holds the code, `.env` with the tracker credentials, the config, `logs/` (Windows and macOS; on Linux the log is the journal), and `state/` (`EVEN_KEEL_STATE_DIR`) with:

- the state database, `state/even-keel/`: the chain, the launch log, closed tasks;
- the installed packages, `state/packages`;
- the embedded statistics database, `state/tally/pgdata`. On your own Postgres the statistics stay in that database.

**In each project's repository:**

- the worktrees of unfinished tasks in `.claude/worktrees/` with their branches `<key>-<number>/task` (`git worktree list`, then `git worktree remove` and `git branch -d`), and the slots of a project with `slot`;
- the lines `.claude/worktrees/`, `.temp/` and `/.codex/rules/even-keel.generated.rules` Even Keel added to `.git/info/exclude`, and that rules file itself;
- with the plugin: `claude plugin uninstall huly@even-keel --scope project` (or `github@…`, `linear@…`, `gitlab@…`, `jira@…`, `forgejo@…`), then commit `.claude/settings.json`.

**In your Claude Code config and the other agents':**

- the plugin credentials in the `env` of `~/.claude/settings.json`, and the marketplace (`claude plugin marketplace remove even-keel`);
- the extra Claude account folders in `~/.claude-accounts` (`EVEN_KEEL_ACCOUNTS_DIR`), each still signed in until you run `claude auth logout` with its `CLAUDE_CONFIG_DIR`;
- the Codex ones in `~/.codex-accounts` (`EVEN_KEEL_CODEX_ACCOUNTS_DIR`) the same, with `codex logout` and its `CODEX_HOME`;
- the OpenCode ones in `~/.opencode-accounts` (`EVEN_KEEL_OPENCODE_ACCOUNTS_DIR`), whose credentials are in `data/opencode/auth.json`: deleting a folder signs it out;
- the GitHub Copilot ones in `~/.copilot-accounts` (`EVEN_KEEL_COPILOT_ACCOUNTS_DIR`), each a `COPILOT_HOME` of its own;
- project memory, moved to `~/.claude-memory/<project>` with `~/.claude/projects/<project>/memory` linking to it: Claude Code keeps using it through the link, so leave it unless you want the memory gone too;
- your skills, moved from `~/.claude/skills` to `~/.claude-skills/<name>` the same way, each leaving a link behind, and so `~/.claude/agents`, `commands`, `hooks` and `output-styles`, to `~/.claude-agents` and the like: leave them, or move the folders back in place of the links.
