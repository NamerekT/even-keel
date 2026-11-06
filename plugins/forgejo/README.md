# Forgejo Issues for Even Keel

The adapter works with Forgejo, Gitea and Codeberg through the Gitea API (`/api/v1`). Add a Forgejo profile in **Settings → Trackers and CI**: the web address of your server (`https://codeberg.org`, `https://git.example.com`, with its path prefix if it has one) and a token with `write:issue`, `read:repository` and `read:user`. The same profile serves Forgejo Actions and pull requests of the remotes on its host.

Select the repository in the project wizard, or set `"tracker": "forgejo", "forgejo": "owner/name"` in an exported project entry. The Even Keel key supplies the task prefix: `APP-12` is issue 12 of that repository.

| Forgejo | Even Keel |
| --- | --- |
| `open` / `closed` | Open (ready) / Closed (done); never "lost" |
| Native dependencies (`blocked by` / `blocks`) | Blockers / blocking tasks |
| `priority: <level>`, `priority/<level>` or `priority::<level>` | Priority; the highest matching label wins |
| Repository milestone | Milestone and due date |
| Estimate | 0 |

**Dependencies may be turned off** for a repository (its settings, or the server's default). The chain then follows milestones, priority and issue number (plus any manual order). Text such as `blocked by #12` is never parsed. Forgejo has no subtasks.

Forgejo has no backlog. Set **Required labels** to a label you add after reading an issue, especially on a public repository, where anyone signed in can file one; the wizard warns about a public repository without them. Only comments of the repository's owner, its collaborators and the token's own account reach a waiting session as an answer or supply a milestone draft's last comment; a member of the owning organization counts when the token may see their write access. Each skipped comment is one line of the log. The card still shows every comment.

## Plugin

On `/tools`, add `forgejo@even-keel` to the project. It brings `forgejo:task` and the official stdio MCP server [`gitea-mcp`](https://gitea.com/gitea/gitea-mcp), checked against version 1.13.0. It is a Go binary, not an npm package: install it from its releases (or `go install gitea.com/gitea/gitea-mcp@latest`) so that `gitea-mcp` is on the service's `PATH`; Even Keel does not pin its version. The gateway maps `GITEA_ACCESS_TOKEN` to the profile's `FORGEJO_TOKEN` and fills `GITEA_HOST` from `FORGEJO_URL` with its scheme. Sessions see only the local gateway, not the token. The package enables the `issue`, `label`, `milestone` and `user` scopes.

For sessions started by hand, add the Even Keel marketplace and run `claude plugin install forgejo@even-keel --scope project`. Supply `GITEA_HOST` and `GITEA_ACCESS_TOKEN` in the session environment: Even Keel writes the default profile's `FORGEJO_URL` and `FORGEJO_TOKEN` to the shared settings, and the MCP placeholders use the names above. Leave `brief` on auto: the plugin then reads the issue itself.
