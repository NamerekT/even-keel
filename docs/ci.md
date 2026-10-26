# CI

Even Keel watches the CI of each project and shows it on the page (BTN-102). After a push of `main` the chain waits for the verdict of the counted CIs before the next launch, and a red `main` is fixed first — by a session without a tracker task, or by a fix task when the project asks for one (BTN-103, BTN-115): how the chain behaves is in `docs/chain.md`, "The CI of main". Without a CI to judge `main`, the project's own check commands do (BTN-104, below).

## The layer

Before a project launches a session, `ProtectionAudit` reads its GitHub/Forgejo remotes independently of workflow
discovery, using the normal remote profiles. Results are cached for five minutes per repository, branch and profile
selection, in `EvenKeelState.protection`. It never changes server rules or blocks a launch. GitHub's active rulesets
and classic branch protection contribute separately to force-push and deletion protection. Each unique active GitHub
ruleset is read for `bypass_actors`: an empty list means no bypass, a nonempty, hidden or inaccessible list keeps the
possible-bypass warning without discarding the protection verdict. Classic protection contributes its administrator
bypass only when it exists. See the [GitHub rules API](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset).
Forgejo's rule list is paged; an exact rule wins over globs, and disagreeing globs yield unknown. Older Forgejo rules
with a boolean `enable_push` but no `enable_force_push` forbid force pushes; an explicit switch takes precedence,
and incomplete or malformed responses stay unknown. Checked live on 2026-10-26: Forgejo 16.0.3 returned these older
rules with `apply_to_admins: true`; GitHub returned an active ruleset with empty `bypass_actors` and no classic rule.
Both remotes reported protected without bypass warnings, using the project's selected profiles. API failures and
unsupported GitLab checks yield unknown. The project page links to branch settings for missing/unverified protection
and administrator bypasses.

`src/ci/` is separate from the tracker layer and knows nothing of tasks beyond the `[KEY-N]` ids in commit subjects.

| File | What is in it |
| --- | --- |
| `model.ts` | the neutral model (`CiRun`, `CiJob`, `CiStep`, `CiView`), the adapter contract `CiSource`, `STUCK_MS`, the run length, the median, the current run, `stuckSince`, `taskIdsOf` |
| `remote.ts` | `parseRemote` (https, ssh and scp forms), `ciTargets`: which remote gets which CI |
| `forgejo.ts`, `github.ts`, `gitlab.ts` | the CI adapters |
| `http.ts` | `getJson` and its notices `ci.denied`, `ci.http`, `ci.unreachable` |
| `adapters.ts` | `CI_TOKENS`, `ciVariables` (kept out of the sessions' environment by `sessionBase`), `ciSource`, `projectTargets` |
| `watcher.ts` | `CiWatch`, one per CI of a project's checkout |
| `shared.ts` | `SharedSources`: shared API answers per repository and token, with runs scoped by branch and limit |
| `verdict.ts` | `verdictOf`: what the CIs say about a pushed commit — green, red, pending or unavailable |
| `report.ts` | `redReport`: the fix session's prompt, the fix task's title, description and comment in en/ru; `logTail` |

The contract is two calls: `runs(limit, branch?)` — the latest runs, newest first, scoped to a branch when given; `jobs(run)` — the jobs of a run with their steps when the CI gives them. A project's watch always passes its branch, so its current run, history and median contain only that branch's runs. GitHub uses the `branch` query parameter; Forgejo uses `ref=refs/heads/<branch>` (`branch` is ignored by Forgejo). PR feedback omits the branch filter and selects the PR's head commit. The optional `log(job)` is a job's log — only GitHub has it (`getText` in `http.ts`); `CiWatch.failed(run)` gathers the failed jobs and the tail of the first log for the fix's text.

## Which CIs the chain counts

`projects[].ci` of the settings, read live, also set from the project's settings panel:

```json
"ci": { "guard": true, "kinds": ["forgejo", "github", "gitlab"], "waitMinutes": 30, "recheckMain": true, "fixTask": false }
```

- `guard` — the guard of `main` as a whole, `true` by default. `false`: no counted CI and no check (`mainCheckDeps` gives the verdict `none`, `checking` no commands, `checkMain` is `skipped`, `mergeCheck` `[]`) — a push is not waited for, nothing is checked before the merge or on `main`, and no fix is made. The other keys are kept and apply again once it is back on. A wait from before it was turned off is released at the next settle; a fix session already running is left alone.
- `kinds` — the CIs whose verdict the chain waits for; without the key — all three (`DEFAULT_CI` in `src/settings/defaults.ts`); empty — none, and the project's own check takes over (below).
- `waitMinutes` — how long the next launch waits after the push: `null` or no key — as long as it takes, `0` — not at all (faster, but the next task may start on a broken `main`).
- `recheckMain` — `false` turns off the second run of the project's check on a `main` that moved (below).
- `fixTask` (BTN-115) — who fixes a red `main`, for a red CI and a failed check alike. `false`, the default — a session without a tracker task, started by the dispatcher, and the working session of the current task is stopped until it is done. The fix is over once its branch is in `main` and the session is not working or waiting: a turn that ended with a background command still running (`shell`, a loop waiting on a CI log) does not hold it, the cleanup stops the session and kills the command (`docs/chain.md`, "Background command"). `true` — a task created in the tracker, taken after the current one; the adapter then needs `create`. Read at the red verdict, so a change applies to the next one.
- The settings panel writes the key only when it differs from the default.
- In PR mode (`pullRequests`, `docs/chain.md`) Even Keel pushes task branches to the pull request's remote, so a workflow `on: push` without a branch filter runs on them too; the failed runs of a pull request's head commit are feedback to the task's session, not a verdict on `main`.

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

Read from `git config --get-regexp ^remote\..*\.url$` and the workflow folders of the project's checkout when the project appears in the config or its `repo` changes (`CiWatches.apply`, `src/ci/watches.ts`), and again every minute for every project (`CiWatches.refresh`): a remote added or a first workflow in the same checkout gets its watch, a CI gone loses it, and a watch whose remote stays keeps its state. Only a change is logged (`ci: <KEY> watches …`, or `watches no CI` when the last one went); a checkout whose remotes cannot be read on a refresh keeps its watches. A changed profile gives every watch a new source at once (`CiWatches.tokensChanged`).

- A `github.com` remote with `.github/workflows` — GitHub Actions.
- A public host of a forge with no adapter (`bitbucket.org`; `UNSUPPORTED_HOSTS` in `src/ci/remote.ts`) — no CI, and no token is asked for (EKR-8). A new adapter takes its host out of that list.
- A `gitlab.com` remote, or a host named by `GITLAB_URL` of any GitLab profile, with a root `.gitlab-ci.yml` file — GitLab CI. Nested groups stay in the project path; a self-managed installation's prefix and web port come from its profile. Profile changes recheck the watches live.
- Any other host — Forgejo, if the repository has `.forgejo/workflows`, or `.github/workflows` (Forgejo falls back to it when it has none of its own). An unknown host without a GitLab profile is taken for Forgejo too; the Forgejo profile's check (`forgejoAccount`) first asks `/api/v1/version` and says the server is not Forgejo or Gitea unless it answers `{ version }` in JSON (a JSON 401/403 there is a server that wants a sign-in for its API, left to the `/user` request).
- No remote or no CI configuration — no CI and no badge.

The token is chosen per remote (`ciToken`, `src/ci/adapters.ts`). The CI is a property of the remote, not of the tracker: a project on Huly with a `github.com` remote has GitHub Actions too (Even Keel itself).

- Forgejo: a Forgejo profile (`FORGEJO_URL`, `FORGEJO_TOKEN`; `src/ci/forgejo-profile.ts`) whose `FORGEJO_URL` has the remote's host — the default one when several do, else the first. `.env` is not read for it: at the first start `importForgejo` (`src/profiles/store.ts`) turns a `FORGEJO_TOKEN` of `.env` into one profile per host of the projects' Forgejo remotes (`docs/storage.md`).
- GitHub Actions: the project's tracker profile if it is a GitHub one, else the default GitHub profile (`docs/trackers.md`, "Profiles"); the token needs **Actions: Read**.
- GitLab CI: the project's GitLab profile on the remote's host, otherwise the default GitLab profile on that host, otherwise the first there. An empty profile address means `https://gitlab.com`. The profile requires a personal token with `api` scope and project access. A Forgejo profile check identifies GitLab by its public host, API metadata, sign-in redirect or `/api/v4/version`, and asks for a GitLab profile instead.

A project can name the profile itself (BTN-231): `remoteProfiles: { github?: <profile id>, forgejo?: <profile id>, gitlab?: <profile id> }`, one per kind, not per remote. The chosen one wins while it exists, is of the target's kind and, for Forgejo and GitLab, is on the remote's host; otherwise the automatic choice above holds, with no error — a profile removed later falls back by itself. PR mode takes the same token (`ciTokenOf` in `src/service.ts`), so the pull requests follow the choice too: checked live on 2026-10-25 with two Forgejo profiles of different users on one host, where the pull request's author followed the choice and a switch to a token without pull request rights refused the next one with `review.notOpened`. A GitHub CI followed the choice live on 2026-10-24. A change applies at once: `projectsChanged` calls `CiWatches.tokensChanged()`. The page offers the choice in the project's Check and CI tab (`remoteChoices`, `web/src/pages/remoteProfiles.ts`) only when the kind has two candidates or a choice is already made.

With no profile for it, or when the token does not reach the repository's runs (`ci.denied`, HTTP 404), the CI of that remote is not shown at all, with no error (`CiWatch.hidden`, all CIs); the log gets a line only when an error appears or changes and one when the CI answers again (BTN-333): the page and the main check take only `CiWatches.shown(project)`. On Trackers and CI of `/settings` a profile's row lists the CIs it serves (`ProfileView.ci`) and says in its tip which ones it does not reach (`ProfileView.hiddenCi`).

Projects in separate clones of one remote (BTN-210) each get their own watches of the same repository, and each waits for the verdict on its own pushes: a watch reads the pushes and the tasks of a run in its own clone. Their sources share API answers for `FRESH_MS` (10 s, below `POLL_MS`), a failure too (`SharedSources` in `src/ci/shared.ts`), keyed by forge, host, owner, repository and token. Runs are further keyed by branch and limit: two projects on different branches never share their run history, while two on the same branch share a poll regardless of their remote names. Jobs are shared by run and status across branches; a log is not shared. Projects whose tokens differ (another profile in `remoteProfiles`) poll apart, since the token decides whether the CI is seen at all. A branch changed live clears the watch's current run, history, median and awaited push and polls the new branch. The fix is shared (BTN-217): while one project of the remote and main branch fixes a red `main`, the others' launches wait and their red pushes start no second fix (`docs/chain.md`, "Projects of one remote").

## A push of Markdown only (this repository's workflows)

A push to `main` that changes only `*.md` outside `plugins/` skips the install, the typecheck and the tests: `scripts/ci-code-changed.sh` diffs the commit before the push (`github.event.before`, fetched at depth 1) with the pushed one, and the later steps run on `code == 'true'`. The run itself still happens and comes out green in seconds. A `paths-ignore` filter would not do: Even Keel waits for a run of every commit it pushes, and a push the CI never takes holds the next launch for `STUCK_MS` and then goes to the project's own check. A pull request, a manual run, a new branch or a `before` the runner cannot fetch run everything. The rebuild of the service on Forgejo still runs: a push before it may have been skipped as no longer `HEAD`.

The cost: the skip trusts the commit before the push. If that one is red and its verdict is never read — the chain stopped waiting for it after `waitMinutes`, then pushed Markdown over it — the push of Markdown comes out green, and the break shows up at the next push with code.

## Polling

GitLab uses `GET /api/v4/projects/<encoded full path>/pipelines` with `ref=<branch>`, newest first, and reads each pipeline's details for `started_at` and `finished_at` (the project list omits them). Jobs use the pipeline's `/jobs` endpoint, following `X-Next-Page` with a full-page fallback and excluding old retries by default; steps and logs are linked through the pipeline page. `created`, `pending`, `scheduled` and resource waits map to queued; `preparing` and `running` to running; `manual` to skipped, so a manual action does not fail main or hold it forever. The adapter uses the same `SharedSources`, `POLL_MS` and hidden-CI rules as the other forges. Checked live on GitLab.com and a self-managed CE 19.5 at the root and under a path prefix, including a pipeline of 106 jobs, a `manual` pipeline (green, the chain goes on), a delayed job (`scheduled`, then green) and a GitLab remote of a Linear project, whose verdict waited for both its Forgejo and GitLab runs. API references: [pipelines](https://docs.gitlab.com/api/pipelines/), [jobs](https://docs.gitlab.com/api/jobs/).

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
- The profile's check is `GET /api/v1/user`: a token without the `read:user` scope gets 403 there (`CredentialsRefused`), even when it reads the runs.
- `limit` without `page` is ignored and the whole history comes back — hundreds of MB of `event_payload`. Always send `page=1`.
- Runs and jobs exist, steps do not: the panel lists Forgejo's jobs and links the run page for the steps. A job's times come from `/actions/tasks` (`run_started_at`, `updated_at`) by its `task_id`.
- An unset time is the zero time of Go or of Unix (`0001-01-01`, `1970-01-01`): read as none, and a run's start falls back to `created`.
- A job's log is not in the API. On the Forgejo host it lies in the data folder as `actions_log/<owner>/<repo>/<task_id % 256, two hex digits>/<task_id>.log.zst`; the `task_id` comes from `GET /repos/<owner>/<repo>/actions/runs/<id>/jobs`. The run number in the page's URL is not the run's id.

GitHub sets `run_started_at` when the run is created, before a runner takes it, so a queued GitHub run has no start.

## The page

`state.ci` maps a project key to its `CiView[]`. The badge (`web/src/pages/CiChip.tsx`, `ci.css`) is the first tab over the side column of the project page, or follows the chain buttons in the project head where there is no column: its dot is the worst level of the project's CIs (`web/src/ci.ts`), and a running run adds its clock. It opens the side panel at `#ci` (`CiPanel`), a card like the backlog's and the settings', with a framed block per CI (BTN-323): the head is its lamp, kind, remote and "All runs", the API's health and when it was checked are the lamp's tip. In view are an error, a stuck or push note and the current or last run — its status, commit, timing against the median of finished runs and the tasks of the push. The jobs (each job's steps folded under it, open when the job failed or is the only one) and the history are `<details>`, folded with their statuses as dots in the summary; a red run opens its jobs. The history shows 5 runs and "Show all"; opened on a fix (`#ci/<fix>`), it opens on its own, with every run when a marked one is past the first 5. The fake: `?ci=…` in `docs/web.md`.
