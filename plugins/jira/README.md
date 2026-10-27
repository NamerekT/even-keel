# Jira Cloud for Even Keel

The adapter works with Jira Cloud (`https://<site>.atlassian.net`); Jira Data Center is not supported. Add a Jira profile in **Settings → Trackers and CI**: the site address, the e-mail of the Atlassian account and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). Even Keel signs in with Basic `e-mail:token` over REST v3, and the check reads `/rest/api/3/myself`. A classic token works on the site itself; a token with scopes is refused there, so Even Keel asks the site for its cloud id and goes through `https://api.atlassian.com/ex/jira/<cloud id>`. A scoped token needs at least `read:jira-work`, `write:jira-work` and `read:jira-user`.

Select the Jira project in the project wizard, or set `"tracker": "jira"` in an exported project entry. The Even Keel key is the Jira project key, and a task id is the issue key as it is: `ABC-12`, branch `abc-12/task`.

| Jira | Even Keel |
| --- | --- |
| status, by its category: To Do — ready, In Progress — in progress, Done — done | status; a To Do-category status named `Backlog` is the backlog, outside the chain |
| `Blocks` issue links | blockers / blocking tasks |
| `Relates` issue links | related links on the card; no ordering |
| Highest, High, Medium, Low, Lowest | urgent, high, medium, low, low; a site's own scheme by its order |
| fix versions | milestone: the earliest by release date |
| parent, subtasks and child issues | parent and children: an issue with children never enters the chain |
| estimate | 0 |

**The order needs the `Blocks` link type.** Even Keel finds it by name when it connects; a site where it was renamed or deleted is refused with a message that names the types it has, so the chain never runs out of order.

**Backlog.** Jira's API does not tell a Jira Software backlog from a board column: both are statuses of the To Do category. Only a status named `Backlog` is kept out of the chain by default. For a board whose backlog is not a status, set **Required labels** or the active statuses of the project instead.

A task is closed by the first transition its workflow offers to a Done-category status. A workflow with no such transition from the current status leaves the issue open and writes so to the log. "Move to Todo" takes a backlog issue through its first transition to a To Do-category status. Descriptions and comments are Atlassian Document Format: Even Keel shows them as Markdown and posts its own comments converted back.

Jira has no CI: CI and PR mode come from the project's git remote.

## Plugin

On `/tools`, add `jira@even-keel` to the project. It brings `jira:task` and the official [Atlassian Rovo MCP server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token/) (`https://mcp.atlassian.com/v2/mcp`). It needs a separate **Atlassian MCP V2 token (optional)** in the Jira profile (`JIRA_MCP_TOKEN`). The gateway builds its Basic header from `JIRA_EMAIL` and `JIRA_MCP_TOKEN`; REST still uses `JIRA_TOKEN`. Sessions see only the local gateway. Without the MCP token the package reports the missing `JIRA_MCP_TOKEN`; projects without the plugin do not need it.

Set up MCP authentication in this order:

1. Ask the organization admin to turn on **API token** authentication in the organization's settings: Connectors → Atlassian MCP server → Authentication.
2. [Create a token for the Atlassian MCP V2 application, with all scopes](https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&appId=mcp-v2&selectedScopes=all), using the profile's e-mail. A classic REST token or a scoped token for the Jira application cannot replace it.
3. Enter it in the profile and press **Check**. Even Keel calls `getAccessibleAtlassianResources` and requires the profile's site in the result. An empty list or another site means the token has no access: create it again after enabling API token authentication. `tools/list` can succeed even for a token whose Jira calls fail.

A community server was not chosen: the official one accepts the API token as it is and keeps up with Jira's API.

For sessions started by hand, add the Even Keel marketplace and run `claude plugin install jira@even-keel --scope project`, and supply `JIRA_BASIC_AUTH` — the base64 of `e-mail:MCP-token`, using the separate Atlassian MCP V2 token — in the session environment. Leave `brief` on auto: the plugin then reads the issue itself.

The live Jira and MCP checks are logged in [What has been verified](../../docs/verified.md#trackers); what is still open is in [What has not been verified](../../docs/unverified.md#jira-mcp-plugin).
