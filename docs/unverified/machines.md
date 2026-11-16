# What has not been verified: Machines

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Machines](../verified/machines.md).

## The machines' stream through a real proxy (BTN-988)

The link between a hub and a machine (`docs/machines.md`) is covered by tests over a wire in memory and by the real HTTPS carrier on loopback: the stream's headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`), each frame written at once, the pinned certificate, and the machine's `link.buffered` notice when a connection opens and not one frame comes over it. It never ran through a real proxy, and no machine connects from elsewhere yet, so there is nothing to run before the service is cut into the two roles.

Assumed: nginx with its default `proxy_buffering on` honours `X-Accel-Buffering: no` for the stream; a proxy that does hold the stream gives the machine an open connection without frames, which is the case the notice tells from a break; the hub's pulse every 20 s keeps a Cloudflare tunnel (about 100 s idle) and nginx's `proxy_read_timeout` (60 s) from closing an idle stream; a proxy that ends TLS works with a token without a fingerprint. If a proxy answers the stream's request with its own error instead, or passes the first frames and holds the later ones, the machine only reconnects and its page shows it offline without the notice about the proxy.

To check, once a machine can be connected: a hub behind nginx with default settings and with `proxy_buffering off; proxy_read_timeout 1h;`, a Cloudflare tunnel, and an HTTPS-inspecting proxy or antivirus between the two.

## The chain over the link in a live installation (BTN-1216)

Since BTN-1216 the chain of every installation reaches its sessions through the hub ↔ machine protocol inside one process (`docs/machines.md`, "One process"): a call of the port is a numbered command and its result an event, the chain reads the machine from a mirror, and the first start of the new version makes the installation's own machine, its token and its consents by itself. This is covered by `src/machine/remote.test.ts`, the sample of the state database before the step and every scenario of `src/e2e/` with the scripted agent. On 2026-11-16 the author's service was updated onto it with a chain running and ran a day of chains on it (BTN-1217's rows in [verified](../verified/machines.md)): the own machine, the kept journal and snapshots, the current task kept across the update, limits, checkpoints, Done and restarts with a session mid-turn passed. Still open: an update from the version before the link while a session is mid-turn, a restart that falls inside a launch, a question across an update, and the page compared before and after.

Assumed: an update over a running chain picks up a session that is mid-turn and keeps the current task; every result and argument of the port survives JSON as the chain reads it; every folder a command names — a session's working folder, a slot — lies inside the project's folder the machine agreed to; a restart of the service in the middle of a launch leaves `command.interrupted` in the log and the launch to the chain's recovery of a starting task. If a session works in a folder outside its project's, its stop, resume or handover is refused and the chain pauses with "the machine refused …: the folder is outside the project's agreed ones"; if a command fails on the machine in a way the chain did not know before, it pauses with "the machine could not run …". Resume goes on once the cause is gone; the log of the service names the command.

To check (BTN-1228): on a second installation, update from a commit before BTN-1216 while a bench task's session is mid-turn and compare the page before and after; ask a question and answer it across an update; restart the service a few seconds after a chain's start, inside the launch (one session, one launch row, the log's `link:` and `machine:` lines); and remove `state/machine/` between two starts (a new own machine is made, the chain goes on).

BTN-1219 also sends launch records, session windows and mailbox changes through the machine's outbox, and reads the page's sessions and mailbox from its mirror. Wire tests cover an offline producer, a lost answer, failure of the separate receipt after a commit, rollback on a failed write, and stale views at reconnect. A live process crash with pending chat changes has not been checked: on the bench, send and deliver mail, restart, and compare the journal, the retained window and the chat before and after; no launch or message should appear twice. A failed record remains in the outbox and holds later events; the service log names the record that failed.

BTN-1221 makes the moves of a task's session on the machine (`docs/machines.md`, "Moves"): a limit, a temporary error, a checkpoint, an answer, "New session", a returned task and the paid-usage stop are commands `task.<move>`, and their state comes back as `task.state` and the result. `src/machine/moves.test.ts` covers them over the wire in memory, and every `src/e2e/` scenario runs them through the one-process link. Assumed: the hub's task gets the move's marks before the session is touched, so a restart mid-move is seen through as before; a `follow` sent only when the mirror shows a refusal, a limit, a move under way or a checkpoint misses none of them. If one is missed, a limit or checkpoint waits until the next fact changes; a move's link failure pauses the chain with "the machine could not run task.…". To check on the bench: a limit with a resume and a handover, a checkpoint, an answer from the chat and a restart of the service in the middle of a handover; the log's `chain:` lines should be the same as before the version.

BTN-1246 gives the machine's assembly its own context (`docs/machines.md`, "The machine's context"): what it reads of the hub comes in the `hub.brief` command, a cleanup's leftover and a watched transcript go back as events, and the account limits, account settings and `cli.downloaded` move into `state/machine/` at the first start. `src/service/hub-brief.test.ts`, `src/machine/state.test.ts`, `remote.test.ts` and every `src/e2e/` scenario cover it. Assumed: a brief sent at every catch-up reaches the machine before the step reads it, so a run set on the page, a check report or a keep-warm task is never a step late; the move of the stores keeps every account's limits and its own settings layer. If the brief lags, a launch picks the account of the project's default run or keep-warm pings a step late; if the move lost rows, the accounts panel shows limits unread until the first poll and a settings transfer writes again. To check on the bench: update across the version with signed-in accounts and compare the accounts panel and each folder's `settings.json` before and after; set a task's run and watch the launch take it.

## MCP servers through the hub in a live installation (BTN-990)

Once the link has started, the machine's gateway carries every server that holds a key to the hub, together with the tasks server (`docs/machines.md`, "MCP through the hub"). `src/packages/gateway.test.ts`, `src/service/hub-mcp.test.ts`, `src/taskmcp/machine.test.ts` and `src/link/link.test.ts` cover the route, the pool check, the hub's absence, the files and the kept writes. No live session has gone this way yet.

BTN-1238 removes two shared-process dependencies: a launch carries its brief from the hub, and the gateway consumes a list of hub routes before resolving a target. Unit and in-memory wire tests cover a machine without a tracker or hub target, retained installs and a handoff without an earlier launch. A separate-machine live check awaits BTN-992: with no tracker credentials on the machine, launch a task, read its brief while the hub is unreachable, hand off after a machine restart, and call a keyed server through both its current and a pinned install. The network assembly must deliver and refresh the hub route list, including after reconnect; a missing route would run locally or fail, and a missing brief would omit the task text. The machine's brief cache is in memory: after a restart, an offline task read has no launch brief until a new launch or handoff supplies one.

Assumed:

- huly-mcp, the GitHub and Forgejo servers and a remote server with OAuth answer a whole POST as they did when the gateway proxied them directly.
- An SSE answer to a POST, read whole and then sent back, is read by Claude Code, Codex, OpenCode and Copilot.
- A server's own messages on a GET stream are not needed: the gateway answers that GET with 405.
- A file a session attaches arrives in the tracker unchanged.

If one of these is wrong, the session's calls of that server fail or time out, the probe holds the chain on `noResponse`, and the log names the request (`link: …`, `hub mcp gateway: …`).

To check on the bench, with a chain task in a Huly project and one in a GitHub project:

- `task_read` with an attachment, and a `task_comment` with a file from `.temp/`.
- A tracker server's list call.
- With the hub's gateway made unreachable mid-session, a comment the session is told is kept should arrive once the gateway is back, and a second task's read should answer that the hub is unreachable.

## One account's limits across machines (BTN-991)

The hub picks one machine to poll `/usage` per claude.ai account and hands the newest limits to the others (`docs/machines.md`, "Account limits"). `src/limits/polls.test.ts`, `src/limits/watcher-plan.test.ts` and `src/machine/remote.test.ts` cover the choice, the plan and its command over the wire in memory. With one machine nothing is sent, so a live installation runs none of it yet.

Assumed: `oauthAccount.accountUuid` of `.claude.json` is the same for one account on every machine and every folder, and it changes in the file when another account signs in to the folder; the 30 s between reads of the file is soon enough after a sign-in. If the id differs per machine, both machines poll the account as before and may meet the 429; if it is stale after a switch, a folder skips polling an account it no longer has until the next read.

To check, once a machine can be connected (BTN-992): sign one account in on the hub and on a machine and see the machine's log stay without its own `/usage` calls while its card shows the hub's numbers; then the account only on two machines, take the polling one off the link and see the other start polling no sooner than five minutes later, with a `limits: machine … polls` line.

## A machine joining from another computer (BTN-1242)

The hub's door for machines (`docs/machines.md`, "Machines elsewhere"): the listener on the machines' port while "Hub address for machines" is set, the one-time connection string, `even-keel join` and the attachment to a project. `src/service/machine-network.test.ts` and `src/link/carrier.test.ts` run the join over real HTTPS on loopback; `src/machine/join.test.ts` the refusals of the command. No machine has joined from another computer yet.

Assumed: Windows Firewall asks once about node listening on all interfaces, and a "Private network" answer is enough for a LAN and Tailscale; the network cards offered are the ones another computer can reach; a Tailscale Service that publishes only the page's port does not pass the machines' port, so its name must not be the address (the field's hint says so); the agent CLIs a machine reports are found on its `PATH` as the user who runs `join` sees it. If the firewall blocks the port, `join` says the hub was not reached and nothing is kept; if a report is wrong, only the page's facts about the machine are.

To check, on the benches: set the address to the hub's Tailscale IP, issue a string, run `even-keel join` on a second computer with a clean installation and see it in `machines/list` with its report; join with the same string again (refused as used), wait 30 min with another (expired), issue twice (the first refused); attach it to a project and see the consent in its `consents` and the folder under its root.
