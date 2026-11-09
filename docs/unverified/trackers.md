# What has not been verified: Trackers

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Trackers](../verified/trackers.md).

## A tracker that did not answer (BTN-825)

The page's calls to a tracker that did not answer fail at once with the error it failed with, instead of waiting the whole timeout again (`TrackerLink.page`, `docs/trackers.md`): the card of a task, a file of it, the task's actions, the vocabulary of a project and the changelog's list of a milestone. The chain's own poll is not silenced — it is what brings the tracker back. Checked by tests against a fake tracker (`src/tracker/link.test.ts`, `src/tracker/control.test.ts`): a timeout, a broken connection ("fetch failed" with its cause), and a tracker that answered (that what was asked for is not there, or that the credentials are refused) — the last two leave the page's calls alone. Still assumed:

- the first request of the page still waits the whole timeout: nothing knows that the tracker is down before it fails;
- the page goes on as usual only after the chain's poll sees the tracker answer again — that poll waits 20, 40, 80, 160 and at most 300 seconds after successive failures, so the page can keep saying that the tracker is down for minutes after it is up;
- the error the page shows is the one the timeout gave it (the timeout's text as it is; "fetch failed" for a broken connection, whose cause the log and the `/status` page name);
- a tracker that refuses the credentials or answers that what was asked for is not there is not a tracker that "did not answer" and does not hold the page's calls.

If an assumption is wrong, the page either waits the whole timeout on every request or says that the tracker is down while it is up. **Workaround:** open the page again when the tracker answers again; the poll notices it by itself. To check: with the tracker host of a project stopped (the author's GitLab CE), open the card of a task and the project's settings, and watch that the second request fails at once, that the page's error names the tracker, and that the page recovers when the host answers again.

## A turned-off tracker profile (BTN-830)

A tracker profile turned off in Trackers and CI reaches nothing of its host, and a chain starts only by tasks read since its tracker last answered (`docs/trackers.md`, "Profiles"). Checked by tests: the profile's rechecks and retries stop, its tracker view is off with no link, its CI gets no token, its task card, vocabulary and project list answer `profiles.disabled` with no call, turning off is refused while a chain on it runs, waits or is queued, and Start refuses a list read before the tracker came back (`src/profiles/service.test.ts`, `src/tracker/trackers.test.ts`, `src/ci/adapters.test.ts`, `src/tracker/control.test.ts`, `src/chain/dispatcher.fresh.test.ts`). The page was seen only on the fake (`?trackers=off`). Still assumed:

- on the live service no request goes to the turned-off host at all — not the poll, the 15-minute recheck, a CI watch, Tally's time reports or a task close;
- turning it on again reads the tasks within the poll's first round, so "Reading tasks…" gives way to Start in seconds, not minutes;
- unattended mode and auto-resume skip a project of the turned-off profile and pick it up again once it is on;
- a tracker that comes back after being down makes Start wait for one fresh read, and that read comes by itself.

If an assumption is wrong, the page keeps waiting on a host that is off, or Start stays on "Reading tasks…". **Workaround:** press Check on the tracker's card in `/status`, which reads its projects now. To check: BTN-864.

## Automatic milestone order (BTN-791)

Unit tests cover transitivity with missing dates and native positions, Jira's sequence pagination and refresh/error paths, and Linear's position conversion and queries. On 2026-11-08 (BTN-835, [verified log](../verified/trackers.md)) the chain, the card's choices, the filled active milestone and a restart followed Jira's version sequence and Linear's milestone `sortOrder` live, with positions set through the API: Jira's `POST /version/{id}/move` and Linear's `projectMilestoneUpdate`. Still assumed: that dragging in Jira's Releases and in a Linear project's milestone list writes those same positions (BTN-849, the user drags); a feed of another tracker (a mixed set was seen only as two Linear projects of one team, the same comparator path); a failing Jira version catalog as such (only a timed-out first read after a restart was seen to recover). Huly, GitHub, Forgejo, GitLab and the built-in tracker provide no native order. A mixed-source or incomplete set falls back to date, number and name; dated milestones precede undated ones. If an assumption is wrong, the chain can choose the wrong milestone, hold a task or stop with a milestone-order conflict. **Workaround:** correct dates/names or blocking links in the tracker and refresh; a Jira catalog request error follows the ordinary tracker-read retry path. To check (BTN-849): seed three milestones against their dates/names on EKJ and TTB, drag them in each tracker's interface, refresh and compare the chain and the card choices. The missing-date and mixed-source policy is recorded for discussion in BTN-834.

## A manual milestone order (BTN-792)

Unit tests cover the sequence (a saved order, a new milestone after its closest automatic predecessor, a gone one dropped), the dispatcher ranking by it so a blocker in a milestone dragged earlier lands instead of `order.later`, the config write and its refusal, and the schema v34 sample; the block's drag and the fix button were seen on `dev:fake` only. Still assumed: that a drag on the live service rewrites the config, reorders the running chain at once without a restart, and that the next tracker read keeps it; that a milestone of a feed sits in the same list; that a milestone closed in the tracker while it still has open tasks drops out (it does not: `TaskMilestone` has no closed flag, so it stays while open tasks carry it). If an assumption is wrong, the chain goes by the automatic order or by the saved one only after a restart. **Workaround:** "Back to automatic", or edit `projects[].milestoneOrder` through `config-export`/`config-import`. To check: on a bench project with two milestones and a blocker in the later one, drag the later milestone up, watch the chain and the `order.later` band, restart the service and compare.

## Statuses on actions (BTN-554)

Moving a task to a chosen status on its start, on its pull request and on its close is checked by tests against faked trackers (`src/chain/moves.test.ts`, `src/tracker/mover.test.ts`, `src/tracker/closer.test.ts`, the adapters' `source.test.ts` of Huly, Linear and Jira, `src/storage/database-profile-moves.test.ts`) and the settings, the add-profile step and the failure band on `dev:fake`. Live on 2026-11-01 ([verified log](../verified/trackers.md)): the start move on Linear and Jira profiles and on a Huly project's own source setting, the automatic close on Huly, and the save refusals of a done status for the start and a status outside done for the close. Still open: the pull request move (no project in PR mode), "leave as is", a feed's own moves over its profile's, a chosen done status (a second done status in the workflow), the failure band and its button, the add-profile step. Seen on the save: a status name the tracker does not have was taken without a word, and the move then failed only when it ran; BTN-667 refuses it on the save (`statusMoves.unknown`), marks such a value "not in the tracker" at its field and logs one set by `config-import`, checked by tests only. Assumed:

- Huly writes the named status like any status change, and every issue status of the workspace is a choice, though a project's type may not have it: such a move is refused by name ("no status") rather than written.
- Linear's `workflowStates` lists the states of every team the key sees, and a name shared by teams is one choice; a team without that name refuses the move.
- Jira's `/rest/api/3/status` lists the site's statuses; a workflow with no transition from the task's status to the chosen one leaves the task where it is (a refusal on the page), and a transition with a screen of required fields is refused by Jira like a refused close.
- The start move runs after the session started and the pull request move after the pull request opened, both asynchronously; a slow tracker answers after the chain has already moved on, which only delays the band.

If one is wrong, a task stays in its status or, at worst, the tracker refuses the move and the page says so; the chain is never held by a move. **Workaround:** move or close the task in the tracker, or set "leave as is" and "automatic". To check (BTN-555): on each of Huly, Linear and Jira, a project in PR mode with the pull request move set, a task's pull request opened and merged; a second done status chosen for the close; a status the workflow cannot reach, for the band and its button; a feed with its own moves; a profile added with the moves step; a status name the tracker lacks — refused on the save, marked at its field when it comes from `config-import`, and that import's log line.

## MCP through OAuth on a tracker profile (BTN-475)

The flow, the refresh and the gateway's Bearer header are checked by tests against fake providers (`src/profiles/oauth.test.ts`, `oauth-protocol.test.ts`, `src/packages/gateway.test.ts`), and the dialog on `dev:fake`. Rovo's v2 flow through protected-resource metadata, consent, token exchange, refresh rotation and MCP access was checked by probes on 2026-10-27 (BTN-416, [verified log](../verified/trackers.md)). BTN-485 applies that discovery in the service; its implementation's discovery and public-client registration with the advertised scopes passed against live Jira and Linear on the same date. BTN-490 additionally checked the running service's starts and guard refusals from localhost and an HTTPS proxy, site access with the saved v2 profile through its gateway, and two consecutive live refresh rotations through isolated instances of the actual profile service and gateway. BTN-495 confirmed that v2 refuses a new controlled HTTPS callback outside the organization's domain rules: consent identifies the callback as restricted and disables Accept. No domain rule or working grant was changed ([verified log](../verified/trackers.md)). Linear and GitHub lost MCP OAuth in BTN-604 before any live check: their MCP servers take the tracker's token. Assumed:

- a fresh browser callback completes over direct HTTPS too. Jira's proxy callback and matching `Host`/`Origin` passed in BTN-490, but loopback proxy requests need no cookie. BTN-494 checked the direct network guard's scoped Lax callback cookie, successful code exchange, one-use state, draft binding, provider denial and guard refusals with clean final URLs in Chromium against a simulated provider and non-local socket addresses ([verified log](../verified/trackers.md)); a fresh consent on a live provider over direct HTTPS has not been repeated;
- a refused refresh or a second 401 marks the grant for reconnecting, and a session's tool call meanwhile fails with an MCP error rather than hangs. On Jira (2026-10-29) a revoked app made the gateway answer with an error rather than hang, but its refresh refusal, 403 `unauthorized_client`, did not mark the grant: BTN-589 ([verified log](../verified/trackers.md)).
- The profile dialog's Check and Save verify the selected MCP OAuth grant against the live providers, including an expired unsaved grant refreshed before its original ten-minute deadline (BTN-491). On Jira a saved and a fresh unsaved grant passed both (2026-10-29, [verified log](../verified/trackers.md)); the expired unsaved grant's refresh has not been exercised live. If it refuses working access, reconnect in the dialog or disconnect OAuth and use the fallback token.
- A refused consent (Cancel or Escape on Atlassian's page, a callback with `error=access_denied`) shows "MCP access was not granted" and logs one `consent` line with the provider's `error`, while a failed code exchange or grant check shows "MCP OAuth did not complete" (BTN-588). Checked by tests only; the live refusal of BTN-489 predates the fix. If wrong, the dialog sends a person who refused to check the network, or the log names the wrong step.

If one is wrong, the button ends in "MCP OAuth did not complete" or the profile's row says "MCP access lost" soon after; sessions get no tracker tools while REST keeps working. **Workaround:** disconnect OAuth in the profile and use the Atlassian MCP V2 token.

## The person of a Jira MCP grant (BTN-590)

Atlassian gives an MCP grant to whoever is signed in to Atlassian in the browser, so it may be another person of the site than the profile's REST token (seen in BTN-489). The dialog checks a new grant at once, and Check, Save and the row compare the grant's person with the REST token's `/myself` `accountId`; a different one is a warning with "Connect again", never a refusal. Assumed, from Atlassian's MCP tool list and its `/me` answer, never seen live: Rovo MCP v2's `atlassianUserInfo` answers a text block of JSON with `account_id` and `name` (a `data` envelope, `accountId`, `displayName`, `nickname` or `email` are read too), and that `account_id` is the `accountId` of Jira's `/myself`. Checked only by tests on fake providers. If the tool is missing or answers otherwise, the person is unknown and nothing is shown: a grant of another person goes unnoticed, as before. If the ids differ for the same person, the warning shows for a correct grant; press "Connect again" signed in as the profile's person, or ignore it. Linear, GitHub and GitLab have no MCP grant (BTN-604): their sessions use the profile's own token, so there is no second person to compare.

## A Jira MCP grant revoked in Atlassian (BTN-589)

A grant revoked in id.atlassian.com → Connected apps was seen in BTN-489: the token check answered 401 `invalid_token`, the refresh 403 `unauthorized_client`, and the probe asked Atlassian's token endpoint every 30 s, two log lines each time. Now any 4xx of the token endpoint with an OAuth `error` (but `slow_down`, `temporarily_unavailable`, `server_error`, 408 and 429) marks the grant for reconnecting, so the row says "MCP: reconnect needed" and nothing more goes to Atlassian; the gateway and the refresh log a failure once per reason and once when it works again, and a failing probe waits longer each time, up to an hour. Checked only by tests on fake providers. If Atlassian answers a revoked grant otherwise (a 5xx, a 4xx without `error`), the profile stays "connected" and is asked again less and less often; press "Connect again" in the profile dialog. If a passing refusal looks like these, a working grant is marked for reconnecting and needs one.

## Task feeds from another tracker (BTN-66)

A GitHub feed of a Huly project ran as a live chain (BTN-326, 2026-10-23): the feed was read on its own profile, that profile's required and excluded labels sorted its issues while the Huly tasks kept the project's rules, its task and a Huly one ran in one chain by priority, its session got the brief with the `Tracker: GitHub, project <owner>/<repo>` line, it was closed in GitHub after the merge, `fillMilestone` filled a feed issue's milestone from another feed issue, the `/status` page showed three connections with the feed under its tracker, and Tally named it by its own id with its title and link (its status and "done" stay empty: Tally reads them from Huly only).

PR mode, a question in a tracker comment and a run label on a GitHub feed's tasks ran live on 2026-10-31 after BTN-651 ([verified log](../verified/sessions.md)): the pull requests closed the feed's issues, and the question and its answer went through the feed issue.

A Huly feed from a second workspace ran on 2026-11-01 ([verified log](../verified/trackers.md)): with no server signed in as its profile, its session got the task in the prompt though the project's `brief` was `false`. Not seen live: the `/status` page's Tally tile in its "failed" and "halted" states.

## A removed key and the global folder's daemon

A removed key also stops the global folder's daemon (`claude daemon stop --any` with the global `CLAUDE_CONFIG_DIR`, from the service); that stop was never run from the service — if it fails, the log has the error and the removed key stays with sessions of that folder until its daemon exits (`docs/accounts.md`). **Workaround:** stop the daemon by hand once no session of the folder is live.

## Forgejo Issues (BTN-476)

The adapter (`src/forgejo/`, `docs/trackers.md`, "Forgejo Issues") ran live on own Forgejo, Codeberg and Gitea on 2026-11-07 (BTN-477, [verified log](../verified/trackers.md)): the chain by a native dependency and a milestone, `complete`, dependencies turned off (`/blocks` still answers there: BTN-789), lists, a question answered in a comment with an outsider skipped, the collaborator routes, the card and a milestone change from it. Still assumed (BTN-790): `PUT /issues/{n}/labels` takes label ids and answers the saved labels (a label put on or taken off from the page); `milestone: 0` clears a milestone; `type=issues` keeps pull requests out (no repository of the check had one); an organization member who is no collaborator reaches a session when the token's account administers the repository (the routes answered so, a live chain was not run). If one is wrong, a label or milestone change from the page is refused, a pull request shows up as a task, or a trusted answer is skipped with a log line. **Workaround:** change labels and milestones in Forgejo, and answer from the page's chat instead of a Forgejo comment.

## A stored Forgejo profile as a tracker (BTN-476)

A Forgejo profile saved before BTN-476 (a CI's, its token without `write:issue`) becomes a tracker profile with no schema step. Its CI kept running after the update, and a project on its token was refused on its first issue read (2026-11-07, BTN-477, [verified log](../verified/trackers.md); the page called that refusal a revoked key; since BTN-788 `/status` and the project page name the missing scope with the button to Trackers and CI, not yet seen on a real Forgejo). Still assumed (BTN-790): its PR mode works as before; the default Forgejo profile's values now go into the global `settings.json`, which they did not before, so a session started by hand gets `FORGEJO_URL` and `FORGEJO_TOKEN` (chain sessions never do, `sessionSecrets`); a project put on it with a token lacking `write:issue` gets a refusal on its first issue read (the profile's sign-in check reads `/user` only and passes). The first-start import of `FORGEJO_URL` and `FORGEJO_TOKEN` from `.env` was run only in tests. If the CI breaks, a stored install loses its checks after the update. **Workaround:** give the token `write:issue` (Forgejo's token page makes a new one) and save it in the profile.

## The Forgejo MCP plugin (BTN-476)

`forgejo@even-keel` runs `gitea-mcp`: a Go binary the user puts on the service's `PATH`, started by the gateway over stdio with `GITEA_HOST` and `GITEA_ACCESS_TOKEN` from the profile and `GITEA_SCOPES: issue,label,milestone,user`. Run live with v1.13.0 on 2026-11-07 (BTN-477, [verified log](../verified/trackers.md)): the gateway starts the bare executable name on Windows, `list_issues` and `issue_read` answer against Forgejo and Gitea (the SDK takes both version strings), and Protection's `deleteForgejo` refuses `issue_write` with `method: delete_comment` through the gateway. The plugin's `forgejo:task` skill did not load in those sessions (BTN-787). Not run (BTN-790): a session following the skill, writing through `issue_write` and reading `milestone_read`, `label_read` and `get_me`, and a path prefix in `GITEA_HOST`. If the binary is missing or not found, the package's server fails and a session has no Forgejo tools; with `brief` auto the prompt then lacks the description. **Workaround:** set the project's `brief` to `true`, or turn the package off for the project.

## A parent with over a page of sub-issues on GitHub (BTN-606)

GitHub and Linear read the subtasks of a parent through `children`, and Even Keel closes the parent once they are all closed and one is done (`docs/trackers.md`). Checked live ([verified log](../verified/trackers.md)): on GitHub a parent closed after its two sub-issues of the same repository (2026-10-31) and after its only sub-issue of another repository (2026-11-02); on Linear a parent closed after its two subtasks (2026-11-01), a team's own parent auto-close next to Even Keel's closed the parent once with no error, and a parent whose subtasks were all canceled stayed open (2026-11-02). Covered by adapter tests only: a GitHub parent with more sub-issues than one page of the `subIssues` query. If the next page is misread, the parent closes while a sub-issue on it is still open, or stays open after all are done. **Workaround:** close or reopen the parent by hand.

## The tasks server in a live session (BTN-768)

Even Keel's own tasks server for the built-in tracker (`docs/trackers.md`, "The tasks server") is checked by tests against the state database in memory (`src/taskmcp/calls.test.ts`), the gateway's route by `src/packages/gateway.test.ts`, and a split through the package by the scripted agent (`src/e2e/builtin.test.ts`); no real CLI has called it. Assumed:

- Claude Code takes the gateway's JSON-only Streamable HTTP answers (no `Mcp-Session-Id`, 405 on `GET`) and loads the five tools at once, without deferring their schemas behind ToolSearch; Codex, OpenCode and Copilot reach them as their other gateway servers.
- An agent follows the `tasks:task` and `tasks:split` skills: it does not read its own task, files a batch in one `tasks_create` with `#N` and `retry`, and edits descriptions by patches rather than whole.
- A session started by hand with the `tasks` plugin reaches `http://127.0.0.1:4748/tasks` and names the project by its key.
- Filing and splitting tasks costs fewer calls and tokens than through the Huly MCP server.

If one is wrong, a session cannot file or edit tasks of the built-in tracker, or does it at Huly's cost. **Workaround:** file and edit the tasks on the project's page. To check (BTN-795): a chain session on a bench project with the `tasks@even-keel` package on — the tools seen at once, a split picked up by the chain, a patch refused for an `old` found twice; a hand session with the plugin; Codex and OpenCode listing the tools; Tally's calls and tokens per task filed, Huly before against the built-in tracker after.

## Retry progress across a service crash (BTN-896)

Tests cover a new tools instance over the same database after two tasks of a three-task batch, every ID saved before the next create, the database folder closed and reopened, concurrent repeats, journal failures, retention and the frozen step-39 sample. A forced service kill against a live external tracker has not been run. Assumed: an ID whose awaited database write finished survives a process crash and the retry resumes with the same order and references. If wrong, a retry duplicates tasks. **Workaround:** check the tracker before repeating an interrupted batch and file only the missing tasks with a new key. A crash between the external create and the local save is covered by operation markers on every adapter (entries below), with a bounded lookup on GitHub, GitLab, Forgejo and Jira; retrying an evicted key remains a limitation. To check: on a registered tracker bench, interrupt a three-task batch after its second saved ID, restart the service, repeat with the same key and check that only the third task is created and every link is correct.

## A reply in a Huly thread as the answer to a question (BTN-897)

A session's question posted as a Huly comment is answered by a reply in that comment's thread, and the reply reaches the session (`docs/trackers.md`, "Huly"). Tests cover the order of the later comments and the replies (`answersAfter`) and the card; the Huly source read a reply added through the API live (the [verified log](../verified/trackers.md)). Assumed:

- a reply typed in Huly's own interface is a `chunter:class:ThreadMessage` attached to the comment, as the one the API added;
- a file attached to such a reply is an `attachment` of the reply, so it is downloaded with the answer;
- the chain passes such an answer on like any later comment: `TrackerQuestions` sees no difference.

If wrong, an answer in the thread does not reach the session, which keeps waiting on its question. **Workaround:** answer with a comment on the task itself, not in the question's thread. To check: on the Huly bench HIN, let a chain session ask a question, reply in the question's thread in Huly's interface with a file attached, and see the session continue on the answer with the file in `.temp/inbox/`.

## Operation markers on Huly and Linear (BTN-905)

A repeat of `tasks_create` after a crash between a create and the save of its ID finds the task by its marker, the task's own id chosen by Even Keel (`docs/trackers.md`, "Retries"). Tests cover it on the built-in tracker in a real database (`src/taskmcp/calls.test.ts`) and on fake Huly and Linear clients (`src/<tracker>/editor.test.ts`); neither tracker has taken a chosen id from these tools live. Assumed:

- Huly's `addCollection` creates the issue under the `_id` given, as it does with the one `generateId` gives now, and `findOne` by `_id` and `space` finds it; a second create with the same `_id` is refused, not stored twice.
- Linear's `issueCreate` takes `input.id` (a UUID v4) as the issue's id and refuses one already taken; `issues(filter: { id: { eq } })` finds it, and answers an empty list rather than an error for an id that does not exist.

If wrong, on Huly a repeat may still duplicate the task or fail on the found one; on Linear a create with `id` may be refused outright, which stops every `tasks_create` with `retry` there. **Workaround:** repeat without `retry`, after checking the tracker for the tasks already created. To check: on the Huly and Linear benches, file a batch with `retry`, read the new tasks' ids in the tracker against the journal's marker; then stop the service between a create and its save (a breakpoint, or a fake `save` that throws), repeat with the same key and check that the task is found, not created again, and that a create with a taken id is refused.

## Operation markers on GitHub, GitLab, Forgejo and Jira (BTN-907)

`tasks_create` recovers an interrupted create by looking for a UUID marker on the first page of the newest 25 tasks (`docs/trackers.md`, "Retries"). Tests on each adapter's fake API cover creation with the marker, an empty description, exact matching, missing markers and API failures; GitHub/Forgejo exclude PRs. Markdown revisions and edits include the comment, and GitHub's source test covers the authenticated REST request and HTTP refusal. No live create/recovery on these four trackers has been run. Assumed:

- GitHub, GitLab and Forgejo keep `<!-- even-keel:<marker> -->` unchanged in Markdown, hide it when rendering and return it on the latest-issues endpoint in creation order, including closed issues.
- Jira accepts the `even-keel` property in the create request and returns it in `/search/jql` with `properties: ["even-keel"]`; a new issue appears in the search in time for recovery. [Jira documents eventual consistency for this search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/).

If wrong, an interrupted create may be duplicated; a Jira property refusal prevents creation. The same risk exists after 25 newer tasks have pushed the original out of the page (PRs also consume GitHub page slots), or after the marker is removed. A found task gets every field of its draft written again (BTN-922); that the adapters' `set` calls take them on a task just recovered is checked only on the built-in tracker. **Workaround:** inspect the tracker before repeating an interrupted batch, and correct wrong fields with `task_update`; if creation refuses the marker, create without `retry` after checking for existing tasks. To check: on each registered tracker bench, create with a retry key, inspect the raw Markdown/property, interrupt between create and journal save, restart and repeat with the same key; check the recovered ID, labels, priority, status, parent, estimate and links and that only one task exists. Check the comment's rendered visibility, a closed task and a lookup failure as well.

## The tasks server on Huly (BTN-779)

The same five tools on a Huly project (`docs/trackers.md`, "The tasks server", the Huly limits) are checked by tests on a fake client (`src/huly/editor.test.ts`), with the Markdown round trip through the real `@hcengineering/text-markdown`. Live, a description's append and replace (BTN-906) and two days of the chain's and a hand session's everyday calls on BTN (2026-11-09) are in the [verified log](../verified/trackers.md): comments, appends and replaces on real descriptions, labels, links by `#N`, components, attachments, a refused patch; so is the bench run on HIN (tables, a duplicate `old`, `already so`, a parent in a batch and its change, a task without a status, fixed code marks, the cost against `huly-mcp`). Assumed:

- A text with inline code inside bold, italics, strikethrough or a link, written through these tools, opens and stays editable in Huly's editor (BTN-894): the tests and the bench check only that Huly's markup of the text written has no code mark beside another (`src/huly/marks.test.ts`), not the editor itself.
- A hand session with the `tasks` plugin finds a Huly project by its task key also when the project's `huly` identifier differs from Even Keel's key.

If one is wrong, a description or a comment does not open in Huly's editor, or a hand session does not find the task. **Workaround:** fix the text in Huly's editor; give the session the project's own address. To check (BTN-873): open HIN-24's description and comment in Huly's editor and edit them; a hand session by key on a project whose `huly` differs from its key.

## The tasks server on GitHub, Linear, Jira, GitLab and Forgejo (BTN-875)

The same five tools on the outer trackers (`docs/trackers.md`, "The tasks server", a paragraph of limits each) are checked by tests that record every request against a fake API (`src/<tracker>/editor.test.ts`); no live tracker has taken a write from them. The requests are written from each API's documentation and the live seed scripts of the benches. Assumed:

- GitHub: `createIssue` takes `parentIssueId`; `addBlockedBy`/`removeBlockedBy` exist under these names for a token of the bench; a close as `DUPLICATE` without naming the duplicate is accepted.
- Linear: a milestone found among the team's projects moves an issue without a project into that project, and `issueRelationCreate` of type `blocks` from the blocker is what the chain reads back as "blocked by".
- Jira: `POST /issueLink` with the blocker as `outwardIssue` shows "blocks" on the blocker; a new task under a story takes the sub-task type and lands as its child; a failed transition after a create leaves one issue, not two.
- GitLab: an issue's REST `id` is its work item's id, so `gid://gitlab/WorkItem/<id>` names it in `workItemUpdate`; a new `task` lands under an issue; on CE a `link_type: blocks` comes back as `relates_to` (and is removed again), on Premium as `blocks`; `milestone_id: 0` clears a milestone.
- Forgejo: `POST`/`DELETE /issues/{index}/dependencies` with `{owner, repo, index}` of the blocker adds and removes "blocked by" on the issue in the path; an organization's priority label is set by relabelling.
- On every one, a hand session with the `tasks` plugin finds the project by its task key, and the chain sees a new task or link at its next read.

If one is wrong, a write fails with the tracker's own error, or a link lands the other way round (the chain then waits on the wrong task). **Workaround:** make the change in the tracker's own interface; the chain reads it as usual. To check: on each tracker's bench with the `tasks@even-keel` package on, file a batch with every field, a parent and `#N` links, move a status, swap a priority and a milestone, link and unlink both ways, patch a description, and read each task back in the tracker and on the card.

## The tasks server on a project's feeds (BTN-892)

The tools route a call by the prefix of its task key to the project's own tracker or a feed's, and `tasks_list` asks all of them at once (`docs/trackers.md`, "The tasks server", Scope). This is checked by unit tests (`src/taskmcp/calls.test.ts`) and one e2e run with the project and its feed both on the built-in tracker (`src/e2e/builtin.test.ts`); no live session has run on a feed of another tracker. Assumed:

- On a Huly project with a GitHub feed, `task_comment(GHI-1)` and a blocker from `tasks_create` land in the GitHub repository through the feed's own profile, and the chain then holds the feed task behind that blocker.
- A feed whose tracker is down leaves the other trackers' lines with an `unreachable, not searched` line, and the call returns before the tracker layer's own timeouts make the session wait long.
- With the tasks server on, a feed task's prompt carries only its ID (`briefOn`), and the session reads it through `task_read`, even when the feed's profile is not the one the tracker's own plugin signs in as.

If one is wrong, a feed task's comment or blocker lands in the wrong tracker or is refused, or the session starts with no brief and cannot read the task. **Workaround:** turn the feed tracker's own plugin on in the project's packages and set `brief: true`. To check: on the Huly bench with a GitHub feed and `tasks@even-keel` on, run a feed task told to comment, file a blocker and list the tasks; read both trackers back.

## The chain roles line and an estimate in minutes (BTN-893)

The `chain:` line, the `estimate` field and the `tasks` plugin's calibration hook (`docs/trackers.md`, "The tasks server") are checked by unit tests (`src/taskmcp/vocabulary.test.ts`, `calls.test.ts`, `src/service/vocabulary.test.ts`, `src/huly/editor.test.ts`, the Jira, GitLab and Linear editor tests on fake clients since BTN-911, `plugins/tasks/hooks/*.test.mjs`) and the chain e2e runs with the built-in tracker; no live session has read the line or set an estimate. Assumed:

- A chain session files a task the chain takes — the status and labels of the line, not the skills' former literal `Todo` and `Manual` — also on a project whose rules put tasks in by another status.
- On Huly, an estimate of 20 minutes shows as 20 minutes (0.33 h) in Huly's own estimate and remaining time, and reads back as `estimate 20 min` in `task_read`.
- On Jira Cloud with time tracking on, `timetracking: { originalEstimate: '20m' }` on create and on a `PUT` shows as "20m" in the issue's Original estimate, and `?fields=timetracking` gives `originalEstimateSeconds` 1200 back; with time tracking off Jira's refusal reads as a plain edit error, not a silent drop.
- On GitLab CE, `POST /projects/:id/issues/:iid/time_estimate` with `duration=20m` sets the issue's estimate, and `time_stats.time_estimate` of the issue's read is 1200.
- On Linear, a team on a Fibonacci scale gets 3 points for 20 minutes and shows them in its own estimate field; a team with estimates off says `estimate: no` and the update is refused before any write.
- On the built-in tracker, the chain list shows a filed task's 20 minutes as the estimate bar of a third of an hour.
- The hook fires on the gateway's tool name in a chain session and on the plugin's in a hand session, shows the medians once, and refuses a far-off step once so the repeat goes through; OpenCode's plugin does the same.

If one is wrong, a filed task stays out of the chain or lands in it when it should not, an estimate is off by a factor of 60, or an estimate call is refused every time. **Workaround:** set the status, the labels and the estimate in the tracker itself; turn the `tasks` plugin's hook off by sending no estimate. To check: on the Huly bench, run a chain task told to file a blocker with an estimate of 20 and read it in Huly; then repeat on a project whose rules take tasks from another status. For the estimate of the others: the same filing on the Jira, GitLab and Linear benches and on a built-in project, read in each tracker's own page.

## Components and attachments through the tasks server (BTN-895)

The `component` and `attach` fields and the path guard (`docs/trackers.md`, "The tasks server", Components and attachments) are checked by unit tests against stubs of each tracker's API (`src/taskmcp/calls.test.ts`, `src/taskmcp/files.test.ts`, the editor and source tests of `src/huly/`, `src/jira/`, `src/gitlab/`, `src/forgejo/`, `src/linear/`, `src/builtin/`); no upload has reached a live tracker. Assumed:

- Huly shows a file attached by the tools on the issue and on the comment, and serves it back through the card; a component set by name lands in the issue's Component field.
- Jira takes the multipart upload with `x-atlassian-token: no-check`, and the comment's `Attached:` line names files the issue then lists; the component replaces the issue's components.
- GitLab's project upload Markdown renders in the description and the note, and the card then lists it as an attachment.
- Forgejo's `…/assets` take the field `attachment` on both the issue and the comment.
- Linear's signed `PUT` succeeds with the returned headers and no key, `attachmentCreate` shows the file on the issue, and the asset link in a comment opens for the workspace's members.
- A chain session's working folder is its worktree, so a screenshot in its `.temp/` is attached and a file of the main checkout or a `.env` is refused.

If one is wrong, an attach call fails with the tracker's error or reports a file the tracker does not show. **Workaround:** attach the file in the tracker's own interface, or link it in the text. To check: BTN-898.

## Attachments of the built-in tracker (BTN-773)

A built-in task's attachments (`docs/trackers.md`, "Attachments") are checked by tests: the store, the bytes and the sweep (`src/builtin/files.test.ts`), the upload and file routes (`src/server-builtin.test.ts`), step 32 and a backup (`src/storage/database-files.test.ts`), the editor's marks (`descriptionUpload.test.ts`), and on the fake page by shots (a synthetic paste and drop). Assumed:

- A real paste from the clipboard (a screenshot tool, a browser's copied image) and a drop from the file manager reach the editor as files in Chrome, Edge and Firefox, also on a phone over the HTTPS address, and the raw-body upload of a large file is not cut by a proxy in front of the service.
- The pasted picture shows in the saved description and opens from its tile on the live service.
- A chain session reads an attachment by the path in its brief or in `task_read` (Claude's Read takes the picture; Codex, OpenCode and Copilot open the path their own way).
- On Windows the hourly sweep removes unreferenced bytes once nothing has them open, and a restored backup serves every picture.

If one is wrong, a picture is not taken or not shown, or a session works without the screenshot it was given. **Workaround:** attach the file in Markdown as a link to where it lies, or describe it in words. To check (BTN-807): paste a screenshot into a bench project's task, save, reload the card; start the task on Claude and on Codex and see the session open the picture; delete it, wait a day, see the bytes gone from `state/even-keel/files/`.
