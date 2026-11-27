# Profiles (BTN-200, `src/profiles/`)

A tracker profile is one tracker account, and every project runs on one. The built-in tracker needs none.

## The model

- A profile is an id (GUID), a kind (`huly`, `github`, `linear`, `gitlab`, `jira`, `forgejo`), a name, values, a default flag, whom it signs in as and when its token expires. It lives in the state database (`tracker_profiles`, `docs/storage.md`). The values are kept under the adapter's variable names (`HULY_URL`, `GITHUB_TOKEN` …), so `setup`, the gateway and Tally take them as they are.
- The adapter's `variables`, `hostVariables`, `optionalVariables` (GitLab: `GITLAB_URL`, blank for GitLab.com; the dialog does not ask for them, EKR-123), `alternatives` (Huly: `HULY_TOKEN`, or `HULY_EMAIL` and `HULY_PASSWORD`), `help`, `profileName`, `account` and `projects` serve the profile's sign-in and its project list (`src/{huly,github,linear,gitlab,jira,forgejo}/profile.ts`).
- A new profile's default name is the account's own — the Huly workspace, the GitHub owner or login, the GitLab user, the Linear organization, the Jira site, the Forgejo host — without the tracker's name: the page draws the tracker as an icon beside it (BTN-1382). Names saved before that keep their "Huly · " prefix; the setup's summary drops it (`profileShortName`). A feed in a server message is `ABC/WEB`, the project and the feed's key (`feedLabel`, `src/config.ts`).
- A project runs on the profile in `projects.profile_id`; without one, or with one of another kind, on its kind's default profile. `Trackers` and `trackerPlans` go by profile id: two projects of one tracker on two profiles are two connections. A kind with projects but no profile is `none:<kind>`, and the wizard's check says to add a profile.
- A feed's profile is `feed_profiles`; a profile a feed runs on counts as in use.

## Forgejo: a tracker and a CI in one profile (BTN-201, BTN-476)

A Forgejo profile serves the tracker and the CI on its host with the same `FORGEJO_URL` and `FORGEJO_TOKEN`; its tip names its projects and the CIs on its host. `profileKinds` (`src/profiles/model.ts`) still takes CI-only kinds as a second argument (a kind without `projects`: no `settings.json`, its card shows the CIs), but none is passed now. Its first-start import is `importForgejo` (`profiles.forgejo.imported`, `docs/ci.md`): the service passes the adapters to `importProfiles` without `forgejo`, since `FORGEJO_TOKEN` alone is the CI's older form; `FORGEJO_URL` beside it adds its host first, and a host that already has a Forgejo profile gets no second one.

## The default profile and sessions started by hand

- The first profile of a kind is its default, and the only one stays so. A new default does not move the projects and feeds the chain has started on the old one (`trackerLocked`): `Profiles.setDefault` links them to the old profile by name (BTN-435). A profile's address stays while anything runs on it (`profiles.hostLocked`).
- **The default's values go into the `env` of the global `~/.claude/settings.json`**, never into a chain session's environment. A session started by hand gets only the default profile of each kind, never another one — a limit, not a bug. An edit of a default rewrites its kind's variables there. The service's start (`Profiles.start`, BTN-1167) only adds a default's variable the file lacks and leaves one already there, even one set by hand.
- `share.ts` copies the file into every account folder, so a chain session can read those keys from its own configuration folder; `chainSettings` blanks them only in its environment. This is accepted, as are `.env`, the state database and its backups, and the guide says so (`docs/guide/security.md`, BTN-1117).
- The default also gives the GitHub Actions token to projects of other trackers, unless a project names its own (`remoteProfiles`, `docs/ci.md`).

### Hidden from sessions started by hand (BTN-1498)

"Hide from hand sessions" / "Give to hand sessions" on a tracker profile's row (`tracker_profiles.hand_sessions`, `Profiles.setHandSessions`, route `profiles/handSessions`). As its kind's default, a hidden profile writes nothing into `settings.json` and takes its kind's variables out, as when there is no default; the start takes out each variable still holding its value instead of adding it, and leaves one set by hand to another value. The flag is the profile's, so a new default brings its own. It changes nothing for the service, the gateway's key pool and chain sessions. It is for a tracker only the service and the benches use: hand sessions then work through `tasks` and need none of its keys.

## Checks

- **Check and save.** The profile dialog's primary action checks new or changed values, then saves in the same operation (`profiles/check`, then `profiles/save`); **Check** alone stays available. A fresh check is reused. A same account on the same host (kind, host, workspace, login) is a warning: it stops the first save, and a second press with unchanged values accepts it. Errors stay in the dialog; the fields are inert until the operation ends; a suggested name is sent with the first save unless the user typed one.
- **The periodic check.** Every profile is checked again every 15 minutes. A refusal by the tracker (`CredentialsRefused`) turns it red and pauses the chains on it with `profiles.paused`, which names the profile; a host that does not answer does not pause them.
- **No answer.** A check that got no answer (`unreachable`) is tried again in 1, 2 and 4 minutes, then waits for the 15-minute check; a refusal waits for it at once. Such a profile is also checked again, at most once a minute, when its tracker's link turns live (`recovered` of `startTracker`) or a CI that takes its token answers again (`onRecovered` of `CiWatch`): the first check comes 15 s after the start, when every call of the service times out for about a minute, and would otherwise keep the profile "not answering" for 15 minutes (BTN-678, `retryLater`, `recheckSoon` in `src/profiles/service.ts`).

## Start only by a fresh read (BTN-830)

`listBlock` of the dispatcher, `readFresh` in `src/tracker/health.ts`: a tracker view remembers when its link last turned live (`liveSince`), and a reader whose last full read (`readAt`) is older was read before the tracker went down or the service started. Start reads such a project's tracker anew first and refuses with `chain.unread` while a reader stays stale: a new task the old list lacks might be first in the order. The home card shows "Reading tasks…" in Start's place until then.

## A profile turned off (BTN-830)

`tracker_profiles.disabled`, `Profiles.setDisabled`, route `profiles/disable`: the switch at the end of its row in Trackers and CI.

- **Off, the service reaches nothing of its host.** `Trackers` builds no link for its plan (the view is `off` with `disabled`, no polling of its projects and feeds); the 15-minute check and the 1-2-4-minute retries skip it; `ciToken` gives no token for a CI that would take it (no other profile's either); `timeTrackers` writes no time through it. A task card, a tool, a vocabulary, a status list or a project list of it answers at once with `profiles.disabled` and a "Turn on" button (`noticeFixOf`), with no call.
- **Its chains do not start.** `profileBlock` holds unattended mode and auto-resume, and Start answers `profiles.disabled` (`disabledBlock` in `src/service/accounts.ts`). Turning off is refused while a chain on one of its projects or feeds is running, paused or queued: `profiles.chainsRunning` names the chains and gives "Stop the chain".
- **Turning on starts nothing:** the profile is checked again at once, and Start waits for a fresh read (above).
- The global `settings.json` keeps the default profile's values, so a session started by hand still gets them.
- The home page dims a project card of a turned-off profile, says so instead of red errors and offers "Turn on"; a Start a stale page still shows asks "Profile X is off — turn it on?" and only turns it on.

## The settings page

`/settings` → Trackers and CI (BTN-355, before Chain rules) has a row per profile and "Add profile" (`SettingsProfiles.tsx`, BTN-325). The settings page itself is in `docs/web/config.md`; what the rows carry:

- The built-in tracker's row is always first (`BuiltinRow`, BTN-769), with no buttons: it has no account to connect or edit.
- A profile's row is quiet while all is well: a lamp, the kind's icon, the name (whom it signs in as and its projects or CIs in the name's tip) and a muted "default". Only what needs a look is coloured: a refusal or no answer, an expiry within 14 days, hidden CI, a refused pull request. Edit, Make default and Remove are text buttons at its end; a tracker profile's row also has "Rules", which opens its tab of Chain rules.
- The page gets a secret as "set", never its value; an empty secret field of a stored profile keeps the stored value.
- While projects use a profile, its host fields stay and it cannot be removed (`profiles.hostLocked`, `profiles.inUse`); a project's profile is closed for change once the chain ran a task of it, like its tracker (`trackerLocked`).

## A profile's chain rules (BTN-66)

A profile may set the chain rules of the projects and feeds on it: `active`, `terminal`, `requiredLabels`, `excludedLabels` in `tracker_profiles.rules`, between the shared rules and a project's own (`docs/chain/entry.md`, "Entry into the chain"). `/settings` has an option per tracker profile in the "Whose rules" pick of the Chain rules group, after "All trackers" (`web/src/pages/ProfileRules.tsx`), suggesting the statuses and labels of its projects' vocabularies. The save (`profiles/rules`) is refused when a project or feed on the profile would clash.

## Status moves (BTN-554)

A profile of a kind that moves statuses (Huly, Linear, Jira) keeps its moves in `tracker_profiles.moves` ([`link.md`](link.md#moving-a-task-to-a-chosen-status-btn-554)): `start`, `review` — a status name or `null` (leave the status), `done` — a done status name; no key — not set.

- Its tab of Chain rules has the section "Statuses on actions", saved after the rules by `profiles/moves`. The picks offer the statuses `profiles/statuses` lists (`null` — the tracker named none, an error — not read): start and review only those in the chain, done only those the rules take for done. A save that breaks this is refused (`statusMoves.outside`, `statusMoves.notDone`), as is a name the read list lacks (`statusMoves.unknown`, BTN-667); with no statuses read the save goes through, there is nothing to check against. A chosen value the read list lacks is marked "not in the tracker" in its pick and in a strip under the field (`missingMove`).
- Moves a `config-import` sets go past that check: once they apply, the service checks the changed ones against the statuses (`changedMoves`, `checkChangedMoves` in `src/service/trackers.ts`) and logs what a save would refuse, without undoing the import.
- Right after a new profile of such a kind is saved, the dialog asks for them in one more step, offered by `defaultMoves` (the first started status in the chain, the started one named for review); "Skip" leaves none.

## The import from `.env` at the first start

The tracker variables of `.env` become the default profile of their kind, and every project of that kind runs on it; the mark `profiles.imported` keeps a second start from importing again, and the log says so. After the import the tracker, the CI and Tally no longer read the tracker variables of `.env`.

## Jira MCP: OAuth and the MCP token

The `jira@even-keel` plugin's server, Atlassian's Rovo MCP v2, takes no REST token, so a Jira profile has two ways to give sessions MCP access. The dialog groups them in one "MCP for sessions" box (BTN-491): OAuth first, the token below. Linear, GitHub and GitLab have no OAuth (BTN-604): their MCP servers take the tracker's own token (`mcpKeys`), so the kind's view says `mcpShared` and the box is one line pointing to the token above. A stored Linear or GitHub grant is dropped when the profiles are read (`readProfiles`) and its row is cleared at the next save.

### The MCP token

`JIRA_MCP_TOKEN`, an optional profile secret, is the way for a server without a browser. `mcpValues.JIRA_BASIC_AUTH` is base64 of `JIRA_EMAIL:JIRA_MCP_TOKEN`, never of the REST token. The organization's admin first turns on API token authentication for the Atlassian MCP server; then [an Atlassian MCP V2 application token with all scopes](https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&appId=mcp-v2&selectedScopes=all) is created.

A check with the field set signs in over REST and calls `getAccessibleAtlassianResources` through MCP v2 (`src/jira/mcp.ts`, JSON and SSE replies, session cleanup); the result must include the profile site's URL (`tools/list` alone proves no access). Without the site, `jira.mcpSite` asks for a new token after the admin's switch; an MCP refusal is `jira.mcpToken`; both offer the creation link on the form. The gateway takes profile edits live. A profile without the field still works over REST, while its Jira package names `JIRA_MCP_TOKEN` as missing.

### The OAuth connection (BTN-475, BTN-485)

`src/profiles/oauth.ts`, `oauth-protocol.ts`; "Connect MCP through OAuth" in the dialog (`web/src/pages/ProfileMcp.tsx`), on a new profile too.

- **The provider** is fixed in `MCP_OAUTH` (Rovo `https://mcp.atlassian.com/v2/mcp`); another kind is refused as `profiles.oauthUnsupported`.
- **Discovery.** Protected-resource metadata comes from the MCP endpoint's 401 `WWW-Authenticate` `resource_metadata`, or `/.well-known/oauth-protected-resource<resource path>` without that parameter. The resource must match the configured MCP URL and its metadata stay on that origin. `authorization_servers` picks an issuer from the provider's allowlist of authorization origins (`https://auth.atlassian.com`); its metadata comes from `/.well-known/oauth-authorization-server<issuer path>`, the issuer must match exactly, S256 must be supported, and every endpoint must pass the same allowlist before registration. Redirects, embedded credentials and non-HTTPS metadata or endpoints are refused.
- **Registration.** A public client is registered dynamically (`token_endpoint_auth_method: none`, any returned client secret ignored). Registration and consent carry the challenge's `scope`, otherwise every resource `scopes_supported`. Discovery and registration on the live provider were checked ([verified](../verified/trackers.md)).
- **The flow** is PKCE S256 with a one-use `state`; a callback's `iss` must match the discovered issuer, its path included, and is required when the metadata advertises it. `profiles/oauth/start` answers the consent URL; the browser window ends at `GET /api/profiles/oauth/callback`, which exchanges the code with the MCP `resource`, checks the grant with `getAccessibleAtlassianResources` against the profile's site and leads to `/settings#trackers` with no code or token in the URL; the dialog polls `profiles/oauth/status` and closes the window.
- **The attempt** is bound to the draft's id, kind and values and lives 10 minutes, at most 32 at once. The server refuses blank fields only as `profiles.incomplete`, so the dialog stops a check, a save or a connection itself and names the blank fields by their labels (`unfilled`, `web/src/pages/profileForm.ts`, BTN-597). `profiles/check` and `profiles/save` take the attempt's id as `oauth` (`null` drops a stored grant). A changed host or account field of a stored profile with a grant is refused (`profiles.oauthExpired`): a new identity never keeps the old MCP one.
- **In the dialog.** The list and the dialog show "MCP: connected through OAuth" or a reconnect state, with no access-token expiry. A completed unsaved grant explains Check → Save and the ten-minute deadline from the start of consent; closing the dialog by any control or the backdrop asks before losing it. Changing the grant voids an earlier check.

### Checking the grant

Both `profiles/check` and `profiles/save` check the selected grant besides REST (`Profiles.checkedAccount`, `McpOAuth.check`, the probe in `src/profiles/mcp.ts`): refresh on expiry or once after a refusal, then call `getAccessibleAtlassianResources` and require the site's URL. A refused refresh or a repeated refusal requires reconnecting; transient errors stay retryable. A fresh draft keeps refreshed credentials in its flow until the save, under its original deadline. With OAuth selected, REST checks, the periodic one included, leave out the fallback MCP token; the save keeps that token for use after OAuth is disconnected. The check's success shares the tracker's result line; a failure uses its error area.

**The grant's person** (BTN-590). Atlassian gives a grant to whoever is signed in to Atlassian in the browser, perhaps not the person of the REST token, and then sessions write under another name with other rights. After the site check, the probe also calls `atlassianUserInfo` (`checkJiraMcp` with an `authorization`; an API token's person is the profile's e-mail, so it is not asked), and its `account_id` and name ride on the grant as `OAuthRecord.user`, kept through refreshes; a failure there leaves the person unknown and the check passes. The REST side is `ProfileAccount.user` (Jira's `/myself` `accountId`), which `Profiles` remembers per profile from every save and periodic check. Different ids give `profiles.mcpOtherAccount` — a warning, never a refusal: `CheckResult.mcpWarning` in the dialog, which checks a new grant at once, and `ProfileView.mcpOAuth.warning` in the row, each a warn band with "Connect again". Unknown on either side is silence. Live behaviour: [unverified](../unverified/trackers.md#the-person-of-a-jira-mcp-grant-btn-590).

### Storing and refreshing the grant

The grant is `tracker_profiles.mcp_oauth` (step 15), never in the profile's values, the key pool, `settings.json` or a session's environment; the page sees only `mcpOAuth.state` (`connected`, `reconnect`) and the warning about the grant's person, never its tokens.

- The gateway refreshes it single-flight (compare-and-swap, so a late refresh cannot restore an edited profile's grant), 30 s before expiry or after a 401, saving a rotated refresh token for the next exchange.
- A refused refresh or a second 401 sets `reconnect`: the row shows "MCP: reconnect needed" with the dialog's "Connect again", and nothing goes to the provider until a new grant. Refused is a 401, `invalid_grant`, `invalid_client`, or any 4xx of an OAuth endpoint with an OAuth `error` except 408, 429, `temporarily_unavailable`, `server_error` and `slow_down` (`oauthHttpError`, BTN-589): Atlassian answers a refresh of an app revoked in Connected apps with 403 `unauthorized_client`.
- A stored grant's failing refresh is logged once per reason, and `MCP OAuth refresh works again` once it succeeds. Old Jira v1 grants need a new connection through the dialog.

### Errors and the log

OAuth failures go through `Profiles`' logger as one English line with the profile kind, the step (`registration`, `consent`, `code exchange`, `grant verification`, `refresh`) and the HTTP status plus the provider's string `error`, or the exception's message (`oauth-error.ts`, BTN-484). A callback carrying `error` or no `code` is the `consent` step: it logs only the provider's `error` (or `no code`), and the page gets `profiles.oauthDenied`; every later failure, an HTTP 400 on the exchange or a 401 on the grant check included, gets `profiles.oauthFailed` (BTN-588). Response bodies, `error_description` and stacks are left out; known credentials, callback codes, state and verifiers are redacted, URL-encoded forms included, and whitespace is flattened. Stored and unsaved refreshes share this path. Checked over a local HTTP provider fixture, the callback's clean redirect included ([verified](../verified/trackers.md)); no live provider refusal was induced.

### The callback address and its cookie

- The callback address is the page's own origin, which the request's `Origin` must match with `Host`: HTTPS, or `http` on a loopback host only (`profiles.oauthAddress`). A page opened on another machine over plain HTTP cannot connect: open it over HTTPS (a Tailscale Service) or on localhost of the service's machine.
- For direct network access, `server-guard.ts` issues an `even-keel-oauth` cookie only on an authenticated `POST /api/profiles/oauth/start`: `HttpOnly`, `SameSite=Lax`, the callback path, ten minutes. Its value is an expiry signed with HMAC-SHA256 under the current access token and a callback-only purpose. `guard.ts` accepts it only on the exact `GET /api/profiles/oauth/callback`, after the Host/Origin checks; it authorizes no other route, method or bearer request. The ordinary access cookie stays Strict, and the OAuth state, PKCE and the draft's binding still decide whether a code can be exchanged.
- On completion or a guard refusal, `oauth-response.ts` serves a static page that replaces the history URL with `/settings#trackers` and reloads it, with `no-store`, `no-referrer` and a hash-restricted CSP. Committing that page first brings the Strict cookie back for the settings request; an HTTP redirect would keep it absent across the cross-site navigation. Guard refusals keep 401/403 and never call `finish`. Checked in Chromium against isolated real server routes and a simulated provider ([verified](../verified/trackers.md)).
