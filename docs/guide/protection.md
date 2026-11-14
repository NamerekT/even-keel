# Protection

Chain sessions run without asking you before each command. Protection is a set of deny rules Even Keel gives every session, so that a force push, a recursive delete or a deleted tracker record is refused whatever the task says. It reduces accidents and is not a sandbox: read [what each agent enforces](#what-each-agent-enforces) before you rely on it, and [Security](security.md) for whose text a session reads.

**Sessions → Protection**, in shared settings or a project's settings, enables default groups of destructive-action deny rules.

They start enabled. A project can turn a group off, add native rules, or use shared protection.

Changes apply when a session starts; running sessions keep their existing settings.

- [The groups](#the-groups)
- [What each agent enforces](#what-each-agent-enforces)
- [Your own deny rules](#your-own-deny-rules)
- [Branch protection on the server](#branch-protection-on-the-server)

## The groups

### Requests to Even Keel's address

**Requests to Even Keel's address** refuses a shell command that sends a request to Even Keel itself: Even Keel lets a request from its own machine through without the page's token, so a session could otherwise change these switches or answer for you ([Security](security.md#what-a-session-may-do)).

It holds for every agent, through the `agent-bridge` plugin.

Turn it off for a project whose tasks work with Even Keel's API.

### Deleting tracker records

**Deleting tracker records** has a switch per tracker: Huly, GitHub, GitLab, Linear, Jira and Forgejo.

Even Keel's MCP gateway refuses the calls of that tracker's MCP server that delete a record, so this holds for every agent, Codex included; it covers tracker servers that reach the session through the project's packages.

Jira's server runs every irreversible change through one tool, so its switch refuses them all, archiving a version too.

The switch above the six turns them all on or off.

"Use shared protection" in a project does not lock the switches: changing any of them gives the project its own values, and turning it back on returns the project to the shared ones.

A switch turned off lets the deletes through Even Keel only: a chain session of Claude runs in auto mode, whose own check may still refuse deleting a record in another system; then delete it yourself.

## What each agent enforces

Claude Code receives permission deny rules; Copilot receives tool deny rules. Codex receives command-prefix rules, which also work in its full-access mode.

### Codex and Copilot: literal command prefixes

Codex and Copilot match literal command prefixes only: defaults cover common push flag orders (`git push -f`, `git push origin -f` for each of the project's remotes) and literal recursive-delete targets.

Both also cover five force-refspecs of the project's main branch, immediately after each configured remote (`git push origin +main`, `+HEAD:main`, `+main:main`, `+main:refs/heads/main`, `+HEAD:refs/heads/main`, for a project whose main branch is `main`).

Codex additionally covers deletion refspecs (`:main`, `:refs/heads/main`) and other spellings of recursive-delete targets (`C:\`, `C:/`, `~/`, `~/*`, `$HOME/`, `../`, `../*`, `/*`).

Other argument orders, refspecs, shell expansions and, on Codex, MCP calls are outside those rules: on Copilot `git push origin main --force` and a push wrapped in `pwsh -Command` still run.

Force-refspecs of other branches remain allowed by these defaults.

A Copilot rule of your own is written `shell(<command>:*)` for a prefix; a `*` anywhere else in it matches nothing.

What does not hold on Codex, as seen live: a command with a redirection (`2>&1`, `> file`), a variable or a substitution is checked as one whole command, so a forbidden push inside it runs; so does one wrapped in `bash -lc`, `sh -c`, `pwsh -Command` or `cmd /c`, a flag after the branch (`git push origin main --force`), a refspec of another branch, merged flags (`-uf`, `-Rf`, `-r -f`) and git's options before `push` other than `-C .` and `--no-pager` (`git -C <dir> push`, `git -c <key=value> push`), and Copilot likewise catches only those two.

### Claude Code and OpenCode

Claude Code and OpenCode also deny the push rules behind any such options (`git -C <dir> push --force`).

Chains joined by `;`, `&&` or `|` are checked command by command.

Huly deletion tools are also denied natively for Claude, Copilot and OpenCode.

OpenCode receives command glob denies and tracker tool denies in its session configuration. Its additional rules are command patterns, one per line: `*` matches any text and `?` one character (for example, `git reset --hard*`).

Its default patterns cover the same push and recursive-delete spellings as Claude's groups. Other spellings and shell wrappers may escape them; the last matching OpenCode permission wins.

Even Keel's built-in config hook appends active Protection denies after the account's and project's permissions, including `agent.build.permission`, so their broad or explicit allows do not override Protection.

No extra package is needed.

### What the rules are not

Keep server-side branch protection enabled. The page explains coverage in a help tip and warns when an agent runs without a sandbox and without Even Keel rules.

Rules can reduce accidental actions; they are not an OS sandbox. What else a session may do, and whose text it reads: [security](security.md).

## Your own deny rules

The agent reads your own deny files alongside Protection. Claude Code and Codex let a deny outweigh an allow; OpenCode uses the permission order described above.

Even Keel does not copy them; the `/tools` page shows what reaches a chain session.

A `deny` or `ask` only in the main checkout's `.claude/settings.local.json` does not — a task worktree does not read that file — and the page marks it with where to move it.

Codex's own `.rules` files of the project's Codex account and the `.codex/rules/` committed on the branch are listed under **Codex rules**.

## Branch protection on the server

Before launching a project's session, Even Keel reads the main branch's protection on GitHub and Forgejo, using the configured branch name and remote profiles.

Missing protection, failed verification and potential administrator bypasses appear on the project page beside a link to the server's branch rules.

Enable rules blocking force pushes and branch deletion there, including enforcement for administrators where appropriate.

Even Keel does not change server rules.

GitHub rulesets with no bypass actors do not show a bypass warning; if the profile cannot read the bypass list, the warning remains. Older Forgejo rules without a force-push switch are recognized as protection too.

Checks are cached for five minutes. No protection check is available for GitLab yet.

Remotes with a warning share one band: the same warning for the same branch is written once, with a link to the rules of each remote.
