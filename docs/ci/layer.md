# The CI layer

## The layer

`src/ci/` reads the CIs of a project's remotes into a neutral model. It is separate from the tracker layer and knows nothing of tasks beyond the `[KEY-N]` ids in commit subjects.

| File | What is in it |
| --- | --- |
| `model.ts` | the neutral model (`CiRun`, `CiJob`, `CiStep`, `CiView`), the adapter contract `CiSource`, and what is computed from runs: pushes, stuck runs, medians, task ids |
| `remote.ts` | `parseRemote` (https, ssh and scp forms), `ciTargets`: which remote gets which CI |
| `forgejo.ts`, `github.ts`, `gitlab.ts` | the CI adapters |
| `http.ts` | `getJson` and its notices `ci.denied`, `ci.http`, `ci.unreachable` |
| `adapters.ts` | `CI_TOKENS`, `ciVariables` (kept out of the sessions' environment by `sessionBase`), `CI_SOURCES` (the adapter of each kind; the end-to-end tests put their fake in place of Forgejo's), `ciSource`, `projectTargets` |
| `watcher.ts` | `CiWatch`, one per CI of a project's checkout |
| `shared.ts` | `SharedSources`: shared API answers per repository and token, with runs scoped by branch and limit |
| `verdict.ts` | `verdictOf`: what the CIs say about a pushed commit — green, red, pending or unavailable |
| `report.ts` | `redReport`: the fix session's prompt, the fix task's title, description and comment in en/ru; `logTail` |

### The contract

An adapter has two calls and two optional ones:

- `runs(limit, branch?)` — the latest runs, newest first, scoped to a branch when given. A project's watch always passes its branch, so its current run, history and median hold only that branch's runs. PR feedback omits the branch and selects the pull request's head commit.
- `jobs(run)` — the jobs of a run, with their steps when the CI gives them.
- `log(job)` — a job's plain-text log (`getText` in `http.ts`).
- `rerun(run)` (BTN-846) — reruns only a run's failed jobs; the run keeps its id and ends anew with a new `stoppedAt`.

| | GitHub Actions | Forgejo | GitLab CI |
| --- | --- | --- | --- |
| runs of a branch | `branch` query parameter | `ref=refs/heads/<branch>` (`branch` is ignored) | `GET /api/v4/projects/<encoded full path>/pipelines?ref=<branch>`, then each pipeline's details for `started_at` and `finished_at` (the list omits them) |
| jobs | the run's jobs | the run's jobs; times from `/actions/tasks` by `task_id`, no steps ("Forgejo traps" in [`workflows.md`](workflows.md#forgejo-traps)) | the pipeline's `/jobs`, following `X-Next-Page` with a full-page fallback, old retries left out; steps linked through the pipeline page |
| log | `/actions/jobs/<id>/logs` with `accept: application/vnd.github+json` (it answers `text/plain` with 415), after a redirect to a signed address | `/api/v1/repos/<owner>/<repo>/actions/jobs/<id>/logs`, `accept: text/plain` | `/api/v4/projects/<id>/jobs/<id>/trace`, `accept: text/plain` |
| rerun | `POST /actions/runs/<id>/rerun-failed-jobs` (the token needs `actions: write`) | none: 16.0.3 (gitea 1.22.0) has no rerun endpoint | `POST /projects/<id>/pipelines/<id>/retry` |

GitLab's states map as `created`, `pending`, `scheduled` and resource waits → queued; `preparing` and `running` → running; `manual` → skipped, so a manual action neither fails `main` nor holds it forever. `plainTrace` strips what a GitLab trace adds to each line before `logTail` reads it: the timestamp with the runner's stream prefix (`00O `, `01E `, `00O+ `) and the `section_start:<ts>:<name>` / `section_end:…` markers; a line that held only a marker goes with it, a section's header on the same line stays. API references: [pipelines](https://docs.gitlab.com/api/pipelines/), [jobs](https://docs.gitlab.com/api/jobs/).

`readFailure` (`src/ci/report.ts`) reads a failed run's jobs and the tail of its first failed job's log (`logTail`, 60 lines without the timestamps GitHub and Forgejo prefix): `CiWatch.failed(run)` for the fix's text, PR mode's `check` for a failed run of the pull request's head the session has not been told of. A log that cannot be read — an older CI, a refusal — leaves the run with its link alone.

`post` in `http.ts` turns a rerun's 401/403 into `ci.rerunDenied`. `CiWatch.rerun` throws `ci.rerunUnsupported` without the call and, after a rerun, polls the history at once and for `WANT_MS`; `SharedSources` passes `rerun` through and drops its cached runs and jobs of that repository after it. The chain's use of it is `ci.rerunFailed` below and `docs/chain/main-ci.md`, "The rerun before the red".

## Branch protection audit

Before a project launches a session, `ProtectionAudit` reads its GitHub and Forgejo remotes, apart from workflow discovery and with the usual remote profiles. It never changes server rules and never blocks a launch. Results are cached for five minutes per repository, branch and profile selection, in `EvenKeelState.protection`. The project page links to the branch settings for missing or unverified protection and for administrator bypasses.

- **GitHub.** Active rulesets and classic branch protection count separately for force-push and deletion protection. Each unique active ruleset is read for `bypass_actors`: an empty list means no bypass; a nonempty, hidden or inaccessible one keeps the possible-bypass warning without dropping the protection verdict. Classic protection adds its administrator bypass only when it exists ([GitHub rules API](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset)).
- **Forgejo.** The rule list is paged; an exact rule wins over globs, and disagreeing globs give unknown. Older rules with a boolean `enable_push` but no `enable_force_push` forbid force pushes; an explicit switch takes precedence; an incomplete or malformed answer stays unknown.
- **Unknown.** API failures and GitLab, which is not audited.
- **A private GitHub repository on the free plan** has no branch protection or rulesets at all (EKR-121): `branches/<b>/protection` and `rules/branches/<b>` both answer 403 "Upgrade to GitHub Pro or make this repository public to enable this feature.", `branches/<b>` 200 with `protected: false`. Only that triple, matched on the `message` of the 403 bodies already read, is `unavailable`; another wording falls back to `unknown`. The page gives it a band of its own with no link and one "Don't show again" — a "Got it" mark per repository URL (`protection.plan:<url>@<project>`) stamped with the branch, so later reads keep it closed (`planProtectionWarnings`).

## Which CIs the chain counts

`projects[].ci` of the settings, read live, also set from the project's settings panel; the panel writes a key only when it differs from the default (`DEFAULT_CI` in `src/settings/defaults.ts`):

```json
"ci": { "guard": true, "kinds": ["forgejo", "github", "gitlab"], "waitMinutes": 30, "recheckMain": true, "fixTask": false, "rerunFailed": true }
```

- `guard` — the guard of `main` as a whole, `true` by default. `false`: no push is waited for, nothing is checked before the merge or on `main`, no fix is made and the commands after a green `main` never run. The other keys are kept and apply again once it is back on. A wait from before it was turned off is released at the next settle; a fix session already running is left alone.
- `kinds` — the CIs whose verdict the chain waits for; without the key — all three; empty — none, and the project's own check takes over (below).
- `waitMinutes` — how long the next launch waits after the push. The default is `null`, as is no key: as long as it takes; `0` — not at all (faster, but the next task may start on a broken `main`).
- `recheckMain` — `false` turns off the second run of the project's check on a `main` that moved (below); a merge whose check before it did not report is checked on `main` anyway.
- `fixTask` (BTN-115) — who fixes a red `main`, for a red CI and a failed check alike. Read at the red verdict, so a change applies to the next one.
  - `false`, the default — a session without a tracker task, started by the dispatcher. The session of the lane that runs the fix is stopped if it is mid-turn (exception 7 in `docs/chain/exceptions.md`); one waiting for an answer is not. Other lanes go on and wait for `main` before their next launch (`docs/chain/main-ci.md`, "Several machines" and "The fix session"). The fix is over once its branch is in `main` and the session is neither working nor waiting: a turn that ended with a background command still running (`shell`, a loop waiting on a CI log) does not hold it; the cleanup stops the session and kills the command (`docs/chain/background.md`).
  - `true` — a task created in the tracker, taken after the current one; the adapter then needs `create`.
- `rerunFailed` (BTN-846) — `true`, the default: the first red verdict on a pushed `main` reruns its failed jobs once and waits up to an hour for them, so a flaky test or a runner failure starts no fix; red again — the fix as above, told it was a second red. `false` — the fix at the first red. Only a CI that can rerun through its API (GitHub, GitLab); with Forgejo among the failed runs nothing is rerun.

In PR mode (`pullRequests`, `docs/chain/pr-mode.md`) Even Keel pushes task branches to the pull request's remote, so a workflow `on: push` without a branch filter runs on them too; the failed runs of a pull request's head commit are feedback to the task's session, not a verdict on `main`.

## The check without a CI (BTN-104)

`projects[].commands.check` — lines run in order, like `commands.beforeStart`; empty — no check. It is in effect when no counted CI will judge `main`: `kinds` is empty, the repository has none of them, or one is not `ok` (`mergeCheck` in `src/chain/mainci.ts`). With `ci.guard: false` it never runs.

The check runs in the session's worktree before the merge and in the next task's place on `main`, never in the main checkout.

### On the branch, before the merge

The `PreToolUse` hook of the built-in `agent-bridge` package (`plugins/agent-bridge/hooks/merge-check.mjs`, `docs/packages/files.md`, "The built-in agent-bridge") sees a Bash command that merges the branch of the session's worktree. Chain sessions get the package through their launch flags; in a session Even Keel did not start, `GET /api/sessions/<id>/check` answers 404 and the hook stays silent. Every agent reports through it: Claude, Codex and Copilot run the same hook (Copilot maps its `powershell` tool to Bash, `docs/sessions/copilot.md`), OpenCode its own plugin `opencode/agent-bridge.mjs`.

1. The hook asks `GET /api/sessions/<id>/check`: `{ commands: [] }` — no check.
2. It runs the commands in the worktree. The first failure blocks the merge (exit 2) with the command, its code and the tail of its output; the session fixes it and merges again.
3. Once every command passed on a worktree without changes to tracked files, it reports the tree of its `HEAD` and the commands with `POST /api/sessions/<id>/check` `{ tree, commands }` (EKR-103). The service keeps the latest report per project and task in memory (`CheckReports`, `src/chain/checkreports.ts`).

### On main, if it moved

Only the hook's report shows the check ran: without the package, with an old one, a merge outside Bash, a report lost to the 2-second timeout or a service restart in between there is none. Before the cleanup the dispatcher takes the reported tree, if its commands are still the project's `commands.check` (`MainCheckDeps.reportedTree`). After the push `MainCheck.pushed` compares it with the tree of `main` and marks the push `checked` (the trees match) or `unreported` (no report, and the project has check commands).

When the CI cannot judge the push — `none` at once, `unavailable` after the wait — `withoutCi` decides:

| The push | What happens | Log |
| --- | --- | --- |
| `checked`: the reported tree is `main`'s | green | `is the tree the check before the merge reported` |
| `unreported` | the check runs on `main`, whatever `recheckMain` says | `the check before the merge did not report` |
| another tree, `recheckMain: true` | the check runs on `main` | — |
| another tree, `recheckMain: false` | nothing runs; the push is neither green nor red and the commands after green do not run | `stays unchecked: main moved past the checked branch, and the check of main is off` |

A push awaiting the check on `main` is `ci[<project>].local` of the chain state. Before the next launch the dispatcher runs the check in that task's place (`checkMain`, a yellow line `ciWait.local` on the page): `TaskPlaces.readyAhead` brings the place to `main` and runs the commands before start, and the check runs only if the place is then on `main` (a task with its own commits is skipped with a log line). A project with no check commands whose CI is unavailable leaves the push watched late, as a push no runner took (`workflows.md`, "Polling"; EKR-136).

### A failure on main

A failure is a red `main` (`MainFailure.check`): the same fix — a session or, with `fixTask`, a task — with the command and the output tail in its text (`redReport`), the same single fix at a time; a failure on the push of the fix stops the chain with `check.fixFailed`.

## Commands after a green main (BTN-156)

`projects[].commands.afterGreen` — lines run in order in the project's main checkout (`repo`) once a push of `main` is green: by the CI or by the project's own check, the same event (`MainCheck.passed`), whether or not `waitMinutes` ran out before the verdict. Without `ci.guard` there is no verdict, so they never run. The point is the project's own service on this machine — build it and restart it — when the CI runs elsewhere (a hosted runner cannot reach the machine) and agents do not build it.

- **Guard.** The commands run only if the main checkout is on the project's `branch` and its `HEAD` is the green commit (`MainCheckDeps.runAfterGreen` in `src/chain/mainci.ts`); otherwise a log line `afterGreen: <KEY>: skipped after <commit>: …`.
- **Once per commit.** Pushes glued into one verdict give one run, for the latest commit. Before the commands start, `ci[<project>].afterGreen` of the chain state (`docs/storage.md`) is set to the commit and saved, so a command that restarts Even Keel itself does not run them again after the restart. One run at a time per project: a green push that comes meanwhile runs after it.
- **A failure is not a red main.** The code is green, the environment broke: no fix, the chain goes on; a `leftovers` entry `afterGreen.failed` under the last task of the push (the warning on the project page) and the output in the service log.
- **The chain waits.** While they run, the next launch of the project is held, `ciWait.after` (`docs/chain/main-ci.md`).
- **On the page** (BTN-829). The first card of the CI panel has an "After green" row under the push: a dot and how the last run went — running on a commit since a time (while `ciWait.after` holds, an "i" after it and "The next task waits for them" in the row's tip, BTN-1378), done, the command that failed with its exit code (the output stays in the log), skipped with the guard's reason (`afterGreen.offBranch`, `afterGreen.pastCommit`), or started with no end seen when the service restarted mid-run; a run that ended has when at the row's right, a cell of its own. The start and end are `ci[<project>].afterGreenRun` of the chain state (`AfterGreenRecord`), written by `MainCheck.afterGreen` and `afterGreenEnded`, so the row survives a restart; a project without `commands.afterGreen` has no row. The view is `MainCheck.view` → `state.mainCi[<project>]` (`MainCiView`, filled in `src/service/hosting.ts`).

### A push by hand

BTN-707. A move of the remote's `main` the chain did not make — `git sync` or `git push` from a terminal — is awaited too, by the counted CIs (`ci.kinds`, guard on) only. How the panel labels it is in `workflows.md`, "The page".

- **Seen.** At every settle, before the chain's own pushes are judged, `MainCheck.settleOutside` reads the remote's `main` the counted watches agree on (`MainCheckDeps.remoteHeads`, each watch's `CiWatch.remoteHead`). A move to a commit that is neither the chain's awaited push (`check`, `local`) nor its last green is a push from outside: `ci: <KEY>: main of the remote is at <commit>, pushed outside the chain; waiting for the CI`.
- **Green** — `passed` as for a push of the chain: `ci[<project>].green`, the commands after green with the same guard and the same once per commit. **Red or without a verdict** — a log line only, no fix, nothing stopped; the CI panel shows the red run.
- **No hold.** It holds no launch (only the commands running hold one), and a newer push replaces the one awaited. A push of the chain of the same commit takes it over (`MainCheck.pushed`).
- **Memory only.** The first look after a start sees no push: a push made just before a restart, or while the service was down, runs nothing. A failure of the commands after such a push stays in the log: a `leftovers` entry belongs to a task, and the push has none.

## Which CI a project has

Read from `git config --get-regexp ^remote\..*\.url$` and the workflow folders of the project's checkout when the project appears in the config or its `repo` changes (`CiWatches.apply`, `src/ci/watches.ts`), and again every minute for every project (`CiWatches.refresh`): a remote added or a first workflow in the same checkout gets its watch, a CI gone loses it, and a watch whose remote stays keeps its state. Only a change is logged (`ci: <KEY> watches …`, or `watches no CI` when the last one went); a checkout whose remotes cannot be read on a refresh keeps its watches. A changed profile gives every watch a new source at once (`CiWatches.tokensChanged`). The rules of `ciTargets`:

- A `github.com` remote with `.github/workflows` — GitHub Actions.
- A public host of a forge with no adapter (`bitbucket.org`; `UNSUPPORTED_HOSTS` in `src/ci/remote.ts`) — no CI, and no token is asked for (EKR-8). A new adapter takes its host out of that list.
- A `gitlab.com` remote, or a host named by `GITLAB_URL` of any GitLab profile, with a root `.gitlab-ci.yml` file — GitLab CI. A GitLab *installation* is the origin and path prefix of one GitLab server: a self-managed one can live under a prefix, and its web port comes from its profile. Nested groups stay in the project path. HTTP(S) remotes take the installation with the longest prefix matching a whole path segment, regardless of profile order, with a root profile as the fallback; with profiles on the host but no matching prefix or root, no target is returned. SSH paths carry no prefix, so the first installation on the host wins; several distinct ones log the selected one once per ordered set. CI and merge requests share this selection; profile changes recheck the watches live.
- Any other host is taken for Forgejo, if the repository has `.forgejo/workflows`, or `.github/workflows` (Forgejo falls back to it when it has none of its own); without either, no CI. The Forgejo profile's check (`forgejoAccount`) first asks `/api/v1/version` and says the server is not Forgejo or Gitea unless it answers `{ version }` in JSON (a JSON 401/403 there is a server that wants a sign-in for its API, left to the `/user` request); a GitLab server, known by its public host, API metadata, sign-in redirect or `/api/v4/version`, is told to take a GitLab profile instead.
- No remote or no CI configuration — no CI and no badge.

Every reader of a checkout's remote addresses (the CI watches, `ProtectionAudit`, `ProjectRemotes`, PR mode, the project and folder checks) goes through `remoteUrls` (`src/git/remote-urls.ts`, BTN-1484): git's answer is kept per git runner and folder while the inode, mtime and size of the checkout's `config` (the common one for a linked worktree, found from `.git`'s `gitdir:` and `commondir` without git) and of its `config.worktree` stay the same. A folder without a `.git` of its own asks git every time; remotes in a global or `include.path` file are seen only after the checkout's own config changes. It took most of the git processes out of the end-to-end tests ([`verified/ci.md`](../verified/ci.md)).

### The token

The token is chosen per remote (`ciToken`, `src/ci/adapters.ts`). The CI is a property of the remote, not of the tracker: a project on Huly with a `github.com` remote has GitHub Actions too (Even Keel itself).

- Forgejo: a Forgejo profile (`FORGEJO_URL`, `FORGEJO_TOKEN`; `src/ci/forgejo-profile.ts`) whose `FORGEJO_URL` has the remote's host — the default one when several do, else the first. The same profile is also a task tracker (`docs/trackers.md`, "Forgejo Issues"): one token for issues, CI and pull requests. `.env` is not read for it; a `FORGEJO_TOKEN` there is imported into profiles once (`importForgejo`, `docs/storage.md`).
- GitHub Actions: the project's tracker profile if it is a GitHub one, else the default GitHub profile (`docs/trackers.md`, "Profiles"); the token needs **Actions: Read**.
- GitLab CI: the project's GitLab profile for the selected installation, otherwise the default GitLab profile for it, otherwise the first there; profiles of other installations on the same host are left out. An empty profile address means `https://gitlab.com`. The profile needs a personal token with `api` scope and project access.

A project can name the profile itself (BTN-231): `remoteProfiles: { github?: <profile id>, forgejo?: <profile id>, gitlab?: <profile id> }`, one per kind, not per remote. The chosen one wins while it exists, is of the target's kind and, for Forgejo, is on the remote's host, or for GitLab, names the selected installation; otherwise the automatic choice above holds, with no error — a profile removed later falls back by itself. PR mode takes the same token (`ciTokenOf` in `src/service.ts`), so the pull requests follow the choice too. A change applies at once: `projectsChanged` calls `CiWatches.tokensChanged()`. The page offers the choice in the project's Check and CI tab (`remoteChoices`, `web/src/pages/remoteProfiles.ts`) only when the kind has two candidates or a choice is already made.

### A CI that is not shown

With no profile for it, or when the token does not reach the repository's runs (`ci.denied`, HTTP 404), the CI of that remote is not shown at all, with no error, for every forge (`CiWatch.hidden`). The log gets a line only when an error appears or changes and one when the CI answers again (BTN-333); the page and the main check take only `CiWatches.shown(project)`. On Trackers and CI of `/settings` a profile's row lists the CIs it serves (`ProfileView.ci`) and says in its tip which ones it does not reach (`ProfileView.hiddenCi`).

A Forgejo repository with Actions turned off answers `/actions/runs` with the same 404 as one the token does not see, and its checkout may still have `.github/workflows`, so `ciTargets` takes the target. Only on that 404 `forgejoSource` asks `GET /api/v1/repos/<owner>/<repo>`: a repository seen with `has_actions: false` makes the runs fail with `ci.actionsOff` (BTN-1500); a repository not seen, a failed request or any other `has_actions` keeps the 404. Such a watch is `CiWatch.off`, not `hidden`: not shown, judging no `main`, in neither `ProfileView.ci` nor `hiddenCi`, so the profile shows no warning. It is polled again every `ERROR_RETRY_MS` like any error, so Actions turned on later bring the CI back without a restart, and turned off at a working CI take it away just as quietly.

### Projects of one remote

Projects in separate clones of one remote (BTN-210) each get their own watches of the same repository, and each waits for the verdict on its own pushes: a watch reads the pushes and the tasks of a run in its own clone.

- **Shared answers.** Their sources share API answers for `FRESH_MS` (10 s, below `POLL_MS`), a failure too (`SharedSources` in `src/ci/shared.ts`), keyed by forge, host, owner, repository and token. Runs are further keyed by branch and limit: two projects on different branches never share their run history, while two on the same branch share a poll regardless of their remote names. Jobs are shared by run and status across branches; a log is not shared. Projects whose tokens differ (another profile in `remoteProfiles`) poll apart, since the token decides whether the CI is seen at all.
- **A branch changed live** clears the watch's current run, history, median and awaited push and polls the new branch.
- **One fix** (BTN-217): while one project of the remote and main branch fixes a red `main`, the others' launches wait and their red pushes start no second fix (`docs/chain/projects.md`, "Projects of one remote").

## Git over HTTPS

BTN-1541. The service's own git takes the token of the remote's profile, so a host without Git Credential Manager (Docker) needs no credential helper set up by hand. `withCredentials` (`src/git/credentials.ts`) wraps a `Git`: a call to a remote (`push`, `fetch`, `pull`, `ls-remote`, a `git sync` alias) reads the folder's remote addresses (`remoteUrls`), keeps the `https:` ones without their user (`credentialUrl`), asks `CredentialsOf` for them and runs git with `credentialEnv`. `credentialedRemote` does the same for `RemoteGit` (`ls-remote` and `clone` of the wizard and of a machine's connect), by the address among its arguments.

- **Nothing kept.** The credentials live only in the call's environment, through git's env-only config (`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, git 2.31+; an older git ignores it and goes on its own helper): for each address `credential.<url>.helper` is reset and then set to a shell helper that prints `EVEN_KEEL_GIT_USERNAME_<i>`/`EVEN_KEEL_GIT_PASSWORD_<i>` of the same environment on `get` and ignores `store` and `erase`. Nothing reaches git's config, a file or a session's environment; a clone's `origin` is the address as typed. A credentialed call sets `core.hooksPath` to a path that cannot be a folder: a hook would see the token, and a session can point the repository's hooks anywhere.
- **Which profile.** `gitCredentials` (`src/ci/git-credentials.ts`) takes the CI's choice: `ciTargets` and `ciToken` with the project's `remoteProfiles`, then the default profile for the host ("The token" above). The user name is the forge's: GitHub `x-access-token`, GitLab `oauth2`, Forgejo and Gitea the profile's login or `even-keel` (they read only the token). GitLab profile tokens are personal access tokens, read from the profile's values as the CI reads them: nothing is refreshed. An address with no profile, `http:`, SSH and local remotes are left to git.
- **Where it applies.** The chain's git on every machine (`MachineOwn.git`: task branch pushes, the main branch's sync, moves), the hub's PR-mode push (`reviewDeps`), the forward carry's fetch, the reassigner's `ls-remote`, the folder checks of a machine's connect ("Right to push") and the clones of the wizard (the host's default profiles, no project yet) and of a connect. The LFS restore after a failed checkout goes on git's own helper.
- **A token that may not write.** `deniedOf` reads the forges' refusals (GitHub "Write access to repository not granted" and "Permission to … denied", GitLab "not allowed to push", Forgejo "permission denied for writing", then curl's 403). Such a push is made once more on git's own credentials, so a read-only CI token never takes away a push a helper of the user's could make; refused again, the result carries `GitResult.denied`, and `syncMain` and `openPull` give `git.readOnly` with the profile's name and the address, its fix the profiles' page (`noticeFixOf`). The task branch push at the end of a turn only logs, as any failure of it.
- **Machines.** The token stays on the hub: a machine asks `POST /link/credentials` for each call (`docs/machines/link.md`, "The two directions").
