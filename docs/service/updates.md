# Updating from the page (BTN-163, `src/updates/`)

The update window on the page (`docs/web/header.md`, "Updates") sends `updates/install` or `updates/revert`; the service side is `Updater` (`updater.ts`), the process that does the work is `run.ts` over `runner.ts`. The same process runs a rebuild after a green push ("Rebuild mode") and a machine's catch-up with its hub ("Follow mode"). A container has no button at all ("Containers" at the end).

## Who may

`updateBlock` (`model.ts`) gives the reason there is no button, the first that holds of:

1. the checkout is still being read;
2. it is not a git checkout (`readCheckout`, `checkout.ts`);
3. Even Keel does not run under a service manager it can drive (`serviceControl`, `control.ts`): the parent process is the tray host of the start at sign-in or a Windows service in `tasklist /svc`, a systemd user unit, a launchd agent;
4. the checkout has tracked changes (`git status --porcelain --untracked-files=no`);
5. HEAD is not on the tag of the installed version. This keeps a developer's checkout (`dev`, a task branch) and one the CI rebuilds out: they update by `rebuild.ps1` or `rebuild.sh` ("Rebuild mode").

The checkout is read at the start and every 10 min. **A package** has no checkout (`packageBlock`): it needs a global install whose `--prefix` is known (`globalPrefixOf`, `prefix.ts`; `global` otherwise — a local install, the npx cache) and a service manager.

## Revert

`logs/update.json` is the record of the last run (`UpdateRecord`). "Revert" is offered only after an update that went through, to the version it came from (`previousOf`), and only when the storage versions it recorded equal the running ones: `{schema: SCHEMA_VERSION, database: SQLITE_VERSIONS + STEPS.length, tally: TALLY_SCHEMA_VERSION}`. The database's version goes on from the numbering of the `node:sqlite` file it replaced: `SQLITE_VERSIONS` (2) are that file's versions, imported once into PGlite (`src/storage/database.ts`). Otherwise `previous.blocked` is `storage` and the page explains the manual way back. A revert release (one that takes back an earlier release, `### Reverted` in its notes) is an update like any other, so it may come after a storage change; the rule is in `docs/releases.md`.

## Settling

Before the process starts, the service waits up to 5 min (`SETTLE_MS`) until `busyChains` (`settle.ts`) is empty: no unpaused chain is launching, handing over or closing a task. The page shows the projects waited for (`progress.waiting`). Not counted as busy:

- **A chain waiting for the CI of main** — for a rebuild that CI is the run calling it, and the wait survives a restart (`state/`). The project's own check (`ciWait.local`) counts.
- **A limit hold** (`limitUntil` or `modelWeek`) with no current task or closing, when its reset is more than 60 s away (or unknown for `modelWeek`). At 60 s or less, or past the reset, the chain counts.

A chain that never settles is not waited for past the 5 min.

## The update process

The service cannot update itself: `git checkout`, `npm ci` and the build replace its own code, and stopping it kills its children on systemd and launchd unless they are detached. So `launchRunner` (`launch.ts`) copies the compiled `dist/src/updates/` to a fresh folder in the OS temp folder (with a `package.json` of `"type": "module"` and the mark `.even-keel-update`), writes the plan there and starts `node run.js plan.json` detached (`detached`, `stdio: 'ignore'`); the service goes on answering. The runner's modules import only `node:*` and each other, so the copy runs alone, and it deletes its folder when done.

It survives the stop of the service, as the sessions do: the Windows host kills only its node child (`Process.Kill`), the systemd unit has `KillMode=process`, the launchd agent `AbandonProcessGroup`.

**The answer** is the last step of every run: the process polls `GET /api/state` (loopback, no token; `stateUrlOf`) for 2 min (`ANSWER_MS`) until a start later than the one before the run answers with the target version, and the same start still answers 10 s on (`STEADY_MS`), so a service crashing in a loop does not pass.

**The steps** (`stepsOf`, `steps.ts`):

| Run | Steps |
| --- | --- |
| update | stop, `git fetch --tags`, checkout, `npm ci`, `npm run build`, start, answer |
| revert | the same without the fetch |
| package | stop, `npm install --global --prefix <prefix> even-keel@<version>` (`install`), start, answer |
| rebuild, `package-lock.json` newer than the installed one | wait for the chains, stop, `npm install`, build, start, answer (the running service holds esbuild's binary) |
| rebuild, the lock unchanged | build, wait for the chains, stop, start, answer |
| follow | `git fetch --all --tags`, `git checkout --detach`, `npm ci` only when `package-lock.json` changed, `npm run build:machine`; no stop of a page, the answer is the hub's contact |

- The checkout keeps the branch it was on (`git checkout -B <branch> <tag>`, so a `git pull` by hand still works) or stays detached.
- npm runs through the node of the process (`npm-cli.js` next to it), since the service's `PATH` may lack it.
- A package's run starts from the data folder: a working folder inside the package would hold it on Windows while npm replaces it (`workingDir`, `runner.ts`).

**Keep-warm ahead of the stop** (BTN-1527). Before every stop of a service with a page — an update, a revert, a rebuild and their rollbacks — the process posts `{ms: 240000}` to `/api/updates/warm` (`WARM_AHEAD_MS`, `warmAhead` in `runner.ts`) and waits up to 200 s: the service's keep-warm pings at once every session whose cache would go cold within 4 minutes and answers once those pings and any already in flight are answered (`KeepWarm.ahead`, `docs/sessions/cache.md`, "Timing"). A refusal, an older service without the route or no answer is one line in `update.log`, and the stop goes on. Follow mode asks nothing: its process has no page.

## Rollback of an update, a revert and a package

The rollback of the page's button and of `even-keel update` (`rollbackOf`, `runSteps`); a rebuild has its own ("Rebuild mode"):

- a failure at stop or fetch only starts the service again and waits for its answer;
- at any later step: stop, check out the commit it started from, install, build, start, answer;
- a package's: stop, install the version it started from (`restore`), start, answer.

A failed stop in the rollback is ignored (the service may be down already); any other failed rollback step ends it, recorded as `rollback.failed`.

## The outcome

- **Where.** The record goes to `logs/update.json` of the data folder (a temporary file and a rename), the log of every step and its output to `logs/update.log` (appended). Neither is under `state/`, so they are no state format. A process that could not even be started (no `dist/src/updates/run.js`) is a `launch` failure, kept in memory.
- **When it is read.** The process writes the record only after its answer step, so after the new service has started (found live in BTN-272). The service reads it at its start and again whenever the file changes (`watchFile`, every 5 s), logs it, and the page shows it as a toast until `updates/seen`.
- **When it is dropped.** A record that does not end on the running version (`leftRunning`: one that went through ends on its target, a failed one on the version it came from, a failed rollback on either) is left out — no result and no "Revert" — since `even-keel update` from a terminal or a `git pull` by hand moved the install after it; the file stays, the log says so (BTN-315).

After a revert the newer release is offered again as "Update": the button is an offer, nothing updates by itself.

## Rebuild mode

`service/rebuild.ps1` and `service/rebuild.sh` (what calls them: [`platforms.md`](platforms.md#rebuild-after-a-green-push)) run the temporary copy of the updater in the foreground (`node dist/src/updates/run.js rebuild`), so the wait for the chains and the step order are one code with the page's button.

**Before the stop.** It checks the clean checkout against the requested SHA after compiling. It reads `startedAt`, the running version and `hubCommit` from `/api/state`: the commit the hub captured at its start and names in its version refusal to machines. For an older hub without that field, the last rebuild record names the commit if its rebuild or rollback started this very process on the recorded version; an older hub restored this way reports the outcome in the update log. Without a known running commit the script exits before stopping the hub: build and restart the intended checkout once by hand.

**A chain merging meanwhile** (BTN-1426). A chain session runs on through the rebuild (it lives in the agent's daemon, not in the service) and may merge its branch into the checkout mid-build; the settling waits only for launches, handovers and closings. So the updater compares HEAD with the target again at the stop and after each build with the service down (`drift` in `runner.ts`):

- **HEAD moved on along the same branch** (the target is its ancestor, the tree clean) — the new HEAD and the version of its `package.json` become the target, one log line names both commits, `npm install` runs when `package-lock.json` changed and the build again, until HEAD holds still: `CATCH_UP_BUILDS` (3) more builds at most, then the run fails.
  - A rebuild that builds before the wait sees it at the stop: with the lock unchanged it builds again with the hub still up and waits for the chains again, `CATCH_UP_BUILDS` times at most, and only then stops it (BTN-1527: a build with the hub down kept it down for minutes, [`verified/updating.md`](../verified/updating.md)). A changed lock, or HEAD still moving after them, stops it first and builds after.
- **Anything else** — another branch, a rewound branch, tracked changes — fails at the stop with the hub left running.
- **Seen after the build** — left to the answer, which fails on the commit, and to the rollback.
- **A merge between the stop and the start** (BTN-1479) — the service comes up on the new HEAD: the answer sees it answering with the commit the checkout moved on to along its branch and fails at once instead of waiting out its 2 minutes, so the rollback builds that commit.

`logs/update.json`'s `to` is the commit built last.

**The rollback of a rebuild.** If the new service fails to start or answer from the target SHA, the updater waits for the chains to settle as before the first stop (a service that came up may be launching the next task, BTN-1479), stops it, restores the previous commit on the checkout's branch (a detached HEAD stays detached), runs `npm ci` and `npm run build`, starts the service and checks its answer.

- It never resets the branch under a merge: a checkout moved on along it is built and started where it is (`rollback.to` in `logs/update.json`, the answer expected from that commit); one moved or edited otherwise is left for inspection, the failure marked `moved`.
- `logs/update.json` records both commits and any failure of the rollback. The page shows which rebuild failed and which commit came back, the one a rollback went on to, or that the moved checkout stopped the rollback (`rebuildMoved`), never that the rollback failed.
- The next green push tries again: the commands after a green main run once per commit ([`docs/ci/layer.md`](../ci/layer.md), "Once per commit"), so a new commit runs them anew.

## Follow mode (BTN-1275)

A machine elsewhere refused for another API version starts the process itself with the hub's commit as the target (`HubFollower`, `docs/machines/elsewhere.md`, "Catching up after a refusal"), by the steps of the table above. Its answer is the hub's contact in `machine-link.json`, not `/api/state`, and a failure is recorded so the same commit is not tried again.

## Containers

There is no update from the page in a container. On Linux, `inContainer` recognizes the image's `/etc/even-keel-container` or the runtime markers `/.dockerenv` and `/run/.containerenv`; the updater reports `container` before checking the install source or probing a service manager. Both the page and the CLI direct updates to Docker Compose on the host, and the CLI refuses a service installation before the npx global install or a machine's join. The image itself: [`platforms.md`](platforms.md#docker).
