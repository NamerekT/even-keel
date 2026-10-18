# CI

Even Keel watches the CI of each project and shows it on the page (BTN-102). After a push of `main` the chain waits for the verdict of the counted CIs before the next launch, and a red `main` is fixed first — by a session without a tracker task, or by a fix task when the project asks for one (BTN-103, BTN-115): how the chain behaves is in `docs/chain.md`, "The CI of main". Without a CI to judge `main`, the project's own check commands do (BTN-104, below).

## The layer

`src/ci/` is separate from the tracker layer and knows nothing of tasks beyond the `[KEY-N]` ids in commit subjects.

| File | What is in it |
| --- | --- |
| `model.ts` | the neutral model (`CiRun`, `CiJob`, `CiStep`, `CiView`), the adapter contract `CiSource`, `STUCK_MS`, the run length, the median, the current run, `stuckSince`, `taskIdsOf` |
| `remote.ts` | `parseRemote` (https, ssh and scp forms), `ciTargets`: which remote gets which CI |
| `forgejo.ts`, `github.ts` | the two adapters |
| `http.ts` | `getJson` and its notices `ci.denied`, `ci.http`, `ci.unreachable` |
| `adapters.ts` | `CI_TOKENS`, `ciVariables` (kept out of the sessions' environment by `sessionBase`), `ciSource`, `projectTargets` |
| `watcher.ts` | `CiWatch`, one per CI of a repository |
| `verdict.ts` | `verdictOf`: what the CIs say about a pushed commit — green, red, pending or unavailable |
| `report.ts` | `redReport`: the fix session's prompt, the fix task's title, description and comment in en/ru; `logTail` |

The contract is two calls: `runs(limit)` — the latest runs, newest first; `jobs(run)` — the jobs of a run with their steps when the CI gives them. The optional `log(job)` is a job's log — only GitHub has it (`getText` in `http.ts`); `CiWatch.failed(run)` gathers the failed jobs and the tail of the first log for the fix's text.

## Which CIs the chain counts

`projects[].ci` of the settings, read live, also set from the project's settings panel:

```json
"ci": { "guard": true, "kinds": ["forgejo", "github"], "waitMinutes": 30, "recheckMain": true, "fixTask": false }
```

- `guard` — the guard of `main` as a whole, `true` by default. `false`: no counted CI and no check (`mainCheckDeps` gives the verdict `none`, `checking` no commands, `checkMain` is `skipped`, `mergeCheck` `[]`) — a push is not waited for, nothing is checked before the merge or on `main`, and no fix is made. The other keys are kept and apply again once it is back on. A wait from before it was turned off is released at the next settle; a fix session already running is left alone.
- `kinds` — the CIs whose verdict the chain waits for; without the key — both (`DEFAULT_CI` in `src/settings/defaults.ts`); empty — none, and the project's own check takes over (below).
- `waitMinutes` — how long the next launch waits after the push: `null` or no key — as long as it takes, `0` — not at all (faster, but the next task may start on a broken `main`).
- `recheckMain` — `false` turns off the second run of the project's check on a `main` that moved (below).
- `fixTask` (BTN-115) — who fixes a red `main`, for a red CI and a failed check alike. `false`, the default — a session without a tracker task, started by the dispatcher, and the working session of the current task is stopped until it is done. `true` — a task created in the tracker, taken after the current one; the adapter then needs `create`. Read at the red verdict, so a change applies to the next one.
- The settings panel writes the key only when it differs from the default.

## The check without a CI (BTN-104)

`projects[].commands.check` — lines run in order, like `commands.beforeStart`; empty — no check. It is in effect when no counted CI will judge `main`: `kinds` is empty, the repository has none of them, or one is not `ok` (`mergeCheck` in `src/chain/mainci.ts`). With `ci.guard: false` it never runs.

- **On the branch, before the merge.** The `PreToolUse` hook of the `checkpoint` plugin (`plugins/checkpoint/hooks/merge-check.mjs`) sees a Bash command that merges the branch of the session's worktree, asks `GET /api/sessions/<id>/check` (404 — not a chain session; `{ commands: [] }` — no check) and runs the commands in the worktree. The first failure blocks the merge (exit 2) with the command, its code and the tail of its output; the session fixes it and merges again. The plugin is installed in user scope, so it reaches the sessions of every tracker.
- **On main, if it moved.** Before the cleanup deletes the branch, the dispatcher reads its tree (`MainCheckDeps.taskTree`); after the push, `MainCheck.pushed` compares it with the tree of `main` (`checked` on the push). When the CI cannot judge the push (`none` at once, `unavailable` after the wait), `withoutCi` decides: the same tree — green, the check before the merge covered it; another tree and `recheckMain` — the push goes to `ci[<project>].local`, and before the next launch the dispatcher runs the check in that task's place (`checkMain`, a yellow line `ciWait.local` on the page): `TaskPlaces.readyAhead` brings the place to `main` and runs the commands before start, and the check runs only if the place is then on `main` (a task with its own commits is skipped with a log line). The check never touches the user's main checkout; only the commands after a green `main` (below) run there.
- **A failure on main** is a red `main` (`MainFailure.check`): the same fix — a session or, with `fixTask`, a task — with the command and the output tail in its text (`redReport`), the same single fix at a time, and a failure on the push of the fix stops the chain with `check.fixFailed`.

## Commands after a green main (BTN-156)

`projects[].commands.afterGreen` — lines run in order in the project's main checkout (`repo`) once a push of `main` is green: by the CI or by the project's own check, the same event (`MainCheck.passed`), whether or not `waitMinutes` ran out before the verdict. Without `ci.guard` there is no verdict, so they never run. The point is the project's own service on this machine — build it and restart it — when the CI runs elsewhere (a GitHub runner cannot reach the workstation) and agents do not build it.

- **Guard.** It is the only place the dispatcher touches the main checkout: the commands run only if it is on the project's `branch` and its `HEAD` is the green commit (`MainCheckDeps.runAfterGreen` in `src/chain/mainci.ts`); otherwise a log line `afterGreen: <KEY>: skipped after <commit>: …`.
- **Once per commit.** Pushes glued into one verdict give one run, for the latest commit. Before the commands start, `ci[<project>].afterGreen` of the chain state (`docs/storage.md`) is set to the commit and saved, so a command that restarts Even Keel itself does not run them again after the restart. One run at a time per project: a green push that comes meanwhile runs after it.
- **A failure is not a red main.** The code is green, the environment broke: no fix, the chain goes on; a `leftovers` entry `afterGreen.failed` under the last task of the push (the warning on the project page) and the output in the service log.
- **The chain waits.** While they run, the next launch of the project is held, `ciWait.after` (`docs/chain.md`).

## Which CI a project has

Read from `git config --get-regexp ^remote\..*\.url$` and the workflow folders of the project's checkout when the project appears in the config or its `repo` changes (`CiWatches.apply`, `src/ci/watches.ts`); a new remote or a first workflow in the same checkout is picked up only after a restart. A changed `GITHUB_TOKEN`/`FORGEJO_TOKEN` in `.env` gives every watch a new source at once (`CiWatches.tokensChanged`).

- A `github.com` remote with `.github/workflows` — GitHub Actions.
- Any other host — Forgejo, if the repository has `.forgejo/workflows`, or `.github/workflows` (Forgejo falls back to it when it has none of its own).
- No remote or no workflows — no CI and no badge.

Tokens come only from the environment: `FORGEJO_TOKEN` for Forgejo, `GITHUB_TOKEN` (shared with the GitHub tracker, needs **Actions: Read**) for GitHub. Without one the CI shows as `off` with the notice `ci.noToken` and is never asked.

## Polling

`main.ts` ticks every watch every 5 s. A tick reads `refs/remotes/<remote>/main` locally — `git push` and `git fetch` (including Even Keel's own `git sync`) move it — and asks the API only when:

- it has never asked (startup);
- the ref moved since the last tick — a push; then for `PUSH_WINDOW_MS` (10 min) until a run of that commit, or one created after the push, shows up;
- a run is unfinished — every `POLL_MS` (15 s);
- the last call failed — every `ERROR_RETRY_MS` (60 s).

A finished run's jobs are not fetched again. The tasks of a run are the ids in `git log <previous run's commit>..<run's commit>` subjects, at most `TASK_COMMITS` commits, read once per run.

`STUCK_MS` (2 min) is when a queued run or a push without a run is called stuck. It was chosen without live runs (no token yet); revisit it against the real queue time of the Forgejo runner.

## Forgejo traps

Checked on Forgejo 16.0.3 (`+gitea-1.22.0`) and code.forgejo.org (17.0-dev):

- With `REQUIRE_SIGNIN` the API is closed without a token.
- `limit` without `page` is ignored and the whole history comes back — hundreds of MB of `event_payload`. Always send `page=1`.
- Runs and jobs exist, steps do not: the panel lists Forgejo's jobs and links the run page for the steps. A job's times come from `/actions/tasks` (`run_started_at`, `updated_at`) by its `task_id`.
- An unset time is the zero time of Go or of Unix (`0001-01-01`, `1970-01-01`): read as none, and a run's start falls back to `created`.

GitHub sets `run_started_at` when the run is created, before a runner takes it, so a queued GitHub run has no start.

## The page

`state.ci` maps a project key to its `CiView[]`. The badge (`web/src/pages/CiChip.tsx`, `ci.css`) is the first tab over the side column of the project page, or follows the chain buttons in the project head where there is no column: its dot is the worst level of the project's CIs (`web/src/ci.ts`), and a running run adds its clock. It opens the side panel at `#ci` (`CiPanel`), a card like the backlog's and the settings': each CI's health, a stuck or push note, the current or last run with tasks, jobs and steps against the median of finished runs, and the history. The fake: `?ci=…` in `docs/web.md`.
