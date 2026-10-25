# GitLab Issues for Even Keel

The adapter works with GitLab.com and self-managed GitLab. Add a GitLab profile in **Settings → Trackers and CI**: a personal access token with the `api` scope, and the web address of your server (empty means `https://gitlab.com`). Use the browser address without `/api/v4`. The check reads `/user` and `/personal_access_tokens/self` to show the account and token expiry. Older servers without the latter endpoint show no expiry.

Select the GitLab project in the project wizard, or set `"tracker": "gitlab", "gitlab": "group/subgroup/project"` in an exported project entry. The Even Keel key supplies the task prefix: `APP-12` is issue `iid` 12 in that project.

| GitLab | Even Keel |
| --- | --- |
| `opened` / `closed` | Opened (ready) / Closed (done) |
| Native `is_blocked_by` / `blocks` | Blockers / blocking tasks |
| `relates_to` | Related links on the card; no ordering |
| `priority::<level>` or `priority: <level>` | Priority; highest matching label wins |
| Project or inherited group milestone | Milestone and due date |
| Native work-item hierarchy, when exposed | Parent and children |
| Estimate | 0 |

**GitLab Free has no blocking links.** Its chain follows milestones, priority and task number (plus any manual order); Premium or Ultimate adds native blocking order. Text such as `blocked by #12` is never parsed. Hierarchies use GraphQL; an older server without that schema leaves parents and children empty.

GitLab has no backlog. Set **Required labels** to a label you add after reading an issue, especially on public projects where anyone can file one. Only notes from members with Reporter access or above (including inherited membership), or the token owner, reach a waiting session as an answer or supply a milestone draft's last comment. Membership lookups that are refused or hidden exclude the author. The card still shows all human notes. System notes are omitted; upload links stay in the Markdown.

## Plugin

On `/tools`, add `gitlab@even-keel` to the project. It brings `gitlab:task` and the stdio MCP server [`@zereight/mcp-gitlab`](https://github.com/zereight/gitlab-mcp), pinned at 2.3.11. The gateway maps `GITLAB_PERSONAL_ACCESS_TOKEN` to the profile's `GITLAB_TOKEN`, and fills `GITLAB_API_URL` from `GITLAB_URL`; the server normalizes it to `/api/v4`. Sessions see only the local gateway, not the profile token. The package enables work-item and milestone tools as well as the default issue tools.

The [official MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/#authentication) rejects a legacy PAT with the `api` scope: it requires an OAuth token with `mcp`, or a separate fine-grained MCP token. The community server accepts the same PAT as the adapter and supports self-managed hosts without interactive OAuth.

For sessions started by hand, add the Even Keel marketplace and run `claude plugin install gitlab@even-keel --scope project`. Supply `GITLAB_PERSONAL_ACCESS_TOKEN` and optionally `GITLAB_URL` in the session environment. Even Keel writes the default profile's `GITLAB_TOKEN` to the shared settings; the MCP placeholder uses the different name above, so supply it explicitly for a hand-started session. Leave `brief` on auto: the plugin then reads the issue itself.

CI and merge-request dispatch are not provided by this adapter. End-to-end GitLab and MCP checks are tracked in [What has not been verified](../../docs/unverified.md#gitlab-issues).
