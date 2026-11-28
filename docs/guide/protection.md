# Protection

Chain sessions run without asking you before each command. Protection is a set of deny rules Even Keel gives every session, so that a force push, a recursive delete or a deleted tracker record is refused whatever the task says. It reduces accidents and is not a sandbox: read [what each agent enforces](#what-each-agent-enforces) before you rely on it, and [Security](security.md) for whose text a session reads.

The groups are in **Settings** → **Sessions** → **Protection** for all projects, and on a project's **Sessions** tab for one. They start on. A project can use the shared protection, turn a group off, or add rules of its own in the agent's own syntax. A change applies when a session starts; running sessions keep what they started with.

- [The groups](#the-groups)
- [What each agent enforces](#what-each-agent-enforces)
- [Your own deny rules](#your-own-deny-rules)
- [Branch protection on the server](#branch-protection-on-the-server)

## The groups

The push and delete groups refuse force pushes and deletes of the main branch and recursive deletes of wide targets (a drive, the home folder, the parent folder). How much of that each agent holds is in [What each agent enforces](#what-each-agent-enforces).

### Requests to Even Keel's address

**Requests to Even Keel's address** refuses a shell command that sends a request to Even Keel itself: Even Keel lets a request from its own machine through without the page's token, so a session could otherwise change these switches or answer for you ([Security](security.md#what-a-session-may-do)). It holds for every agent. Turn it off for a project whose tasks work with Even Keel's API.

### Deleting tracker records

**Deleting tracker records** has a switch per tracker — Huly, GitHub, GitLab, Linear, Jira and Forgejo — and one above them that turns them all on or off.

- Even Keel's MCP gateway refuses the calls of that tracker's MCP server that delete a record, so it holds for every agent, for the tracker servers a project's packages bring.
- Jira's server runs every irreversible change through one tool, so its switch refuses them all, archiving a version too.
- A project on the shared protection does not have the switches locked: changing one gives the project its own values, and turning "Use shared protection" back on returns it to the shared ones.
- A switch turned off lets the deletes through Even Keel only: a Claude Code chain session runs in auto mode, whose own check may still refuse deleting a record in another system; then delete it yourself.

## What each agent enforces

Each agent gets the rules in its own form: Claude Code as permission deny rules, Copilot as tool deny rules, Codex as command-prefix rules (which hold in its full-access mode too), OpenCode as command patterns in its session configuration. Codex and Copilot match a command's literal start only, so they catch fewer spellings:

| | Claude Code and OpenCode | Codex | Copilot |
| --- | --- | --- | --- |
| A force push of the main branch, in the usual flag orders (`git push -f`, `git push origin -f`, `+main`) | yes | yes | yes |
| A flag after the branch (`git push origin main --force`) | yes | no | no |
| git's options before `push` (`git -C <dir> push --force`) | yes | only `-C .` and `--no-pager` | only `-C .` and `--no-pager` |
| A force refspec of another branch (`git push origin +feature`) | yes | no | no |
| Deleting the main branch on the remote (`git push origin :main`) | yes, any branch | yes | no |
| Recursive deletes of wide targets | yes | yes, more spellings (`C:\`, `~/`, `../*`…) | the plain spellings |
| A command inside `bash -c`, `pwsh -Command`, `cmd /c`, or with a redirection or a variable | may slip through | slips through | slips through |
| Merged or split flags (`-uf`, `-Rf`, `-r -f`) | slip through | slip through | slip through |

Claude Code and OpenCode check commands joined by `;`, `&&` or `|` one by one. Huly's deleting tools are also denied in the agent's own rules for Claude Code, Copilot and OpenCode. On OpenCode, Even Keel puts its denies after the account's and the project's permissions, so a broad allow there does not override Protection.

### Writing a rule of your own

- **Claude Code:** a rule that ends in `:*` is a prefix, and the words before it are taken literally, `*` included, so `Bash(git push * :*)` matches nothing. Where the text before it holds a `*` or the colon is part of the command, end the rule in `:**` instead (`Bash(rm -rf C:**)`).
- **Copilot:** `shell(<command>:*)` for a prefix; a `*` anywhere else matches nothing.
- **OpenCode:** command patterns, one per line: `*` matches any text and `?` one character (`git reset --hard*`). The last matching permission wins.

### What the rules are not

Rules reduce accidents; they are not an OS sandbox. Keep the branch protection on the server. The page explains what each agent covers in a help tip and warns when an agent runs without a sandbox and without Even Keel's rules. What else a session may do, and whose text it reads: [Security](security.md).

## Your own deny rules

The agent reads your own deny files alongside Protection; Even Keel does not copy them. Claude Code and Codex let a deny outweigh an allow; OpenCode goes by the order above.

- **Tools** in the gear menu shows what reaches a chain session.
- A `deny` or `ask` only in the main checkout's `.claude/settings.local.json` does not reach one — a task worktree does not read that file — and the page marks it with where to move it.
- Codex's own `.rules` files of the project's Codex account and the `.codex/rules/` committed on the branch are listed under **Codex rules**.

## Branch protection on the server

Before a project's session starts, Even Keel reads the main branch's protection on GitHub and Forgejo, with the project's branch and remote profiles. It does not change the server's rules. No such check is available for GitLab yet.

- Missing protection, a failed check and possible administrator bypasses show on the project page with a link to the server's branch rules. Turn on rules there that block force pushes and deleting the branch, for administrators too where it fits.
- GitHub rulesets with no bypass actors show no bypass warning; if the profile cannot read the bypass list, the warning stays. Older Forgejo rules without a force-push switch count as protection too.
- GitHub's free plan has no branch protection for private repositories: the page says so instead — make the repository public or upgrade to GitHub Pro. "Don't show again" closes that warning for the repository and branch for good.
