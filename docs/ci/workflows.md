# Workflows, polling and the page

## This repository's workflows

`.forgejo/workflows/test.yml` and `.github/workflows/test.yml` run two jobs (BTN-699): `test` — the install, `npm run typecheck` and `npm test`, the unit tests — and `e2e`, `npm run test:e2e`, the end-to-end scenarios of `src/e2e/` (`docs/chain/e2e.md`). On GitHub `e2e` is three shards by file (`--shard=N/3`, `fail-fast: false`), each on its own runner beside `test`. On Forgejo it is one job: the instance's one runner takes one job at a time, so shards would only queue ([`verified/ci.md`](../verified/ci.md)).

Pushes and pull requests are checked on GitHub only: a run there takes ~3.5 min, the same check on Forgejo 8–10 min plus the queue behind other repositories. Even Keel's own project has `ci.kinds: ["github"]`, so the verdict on `dev` and the fix of a red one come from GitHub. The Forgejo workflow keeps the two jobs, one after another, but runs only by `workflow_dispatch`; the file stays because without `.forgejo/workflows` Forgejo would run `.github/workflows` on push. The maintainer's service is rebuilt by `commands.afterGreen` after GitHub's green (`docs/service.md`); a `git sync` of `dev` by hand rebuilds it the same way ([`layer.md`](layer.md), "A push by hand"), and the Forgejo panel stays without a "waiting for a run" line.

The nightly workflows below are read as "The release gate of the nights" says.

- **"Real CLIs"** — `.github/workflows/cli-e2e.yml` (BTN-572, BTN-784, BTN-818), every night at 02:30 UTC and by hand, on `ubuntu-latest`. It runs the chain's scenarios on the checked CLIs with a scripted model (`docs/chain/e2e-cli.md`), one job per CLI — `opencode`, `claude`, `claude-sdk` (the same CLI on sessions of kind `sdk`), `codex`, each its own `src/e2e-cli/<cli>.test.ts`, a red one not stopping the others. Each job keeps the checked copies its file fetches in the Actions cache, the whole `.temp/e2e-cli/` (`claude-sdk` needs the CLI's `claude/` and the SDK's `claude-sdk/`), keyed by the job and the file that holds its checked version (`src/opencode/adapter.ts`, `src/claude/adapter.ts`, `src/codex/version.ts`).
- **"Latest CLIs"** — `.github/workflows/cli-latest.yml` (BTN-888), at 03:30 UTC and by hand. The same scenarios on the latest Claude Code, Codex and OpenCode (`docs/chain/e2e-cli.md`). Equal latest and checked versions skip successfully; discovery errors fail. It leaves out SDK sessions, which always use the checked version, and does not join the release gate: a red night is a prompt to check a CLI version.
- **"Tracker contract"** — `.github/workflows/trackers-e2e.yml` (BTN-470), at 03:00 UTC and by hand. The tracker adapters' contract on live trackers ([`docs/trackers/link.md`](../trackers/link.md#contract-tests-on-live-trackers-btn-470-srce2e-trackers)), its stands from the secret `TRACKER_STANDS`, joining the tailnet first when the Tailscale secrets are set. The night skips the Huly stand, up only on demand; its run by hand with `on_demand` is "Huly contract" (`scripts/huly-contract.sh`, BTN-1489).
- **"macOS"** — at 02:10 UTC, and on pushes ("macOS" below).

### The release gate of the nights

`scripts/nights-green.sh` (BTN-470) holds every release on a red night; `publish.yml` runs it before `npm publish`, and a release's first step names it (`docs/releases.md`, "A release").

- **What it reads.** The latest finished run of "Tracker contract" (not titled "Huly contract"), "Real CLIs" and "macOS", of the night or by hand on `dev`, and fails unless it is a success. It takes the latest "Huly contract" on `dev` the same way and fails with none yet, since nothing starts that run by itself.
- **Where a night runs.** GitHub fires a schedule only from the default branch, `main`, and starts it only once the workflow is there: a new nightly workflow runs from the first release that has it. So a night checks out `dev`, and its run is listed under `main`, which no project's watch reads: a red night files no fix and stops no session; it holds releases instead. A run by hand checks the branch it is started on and counts in that branch's verdict like any run of its head: a red one on `dev` is a red `dev` and files the fix.
- **No run yet.** A nightly workflow with no run passes with a note. "macOS" is the exception: it left the push check of `dev` for its night, so with no run on `dev` it holds the release; `gh workflow run macos.yml --ref dev` gives one.
- **Lifting it.** A red night is lifted by a fix on `dev` and a green run by hand (`gh workflow run <workflow> --ref dev`); a red or missing Huly contract by a green `sh scripts/huly-contract.sh`.
- GitHub mails the failure of a scheduled run to whoever last changed its schedule.

### Action dependencies

Third-party actions (`tailscale/github-action`, `mxschmitt/action-tmate`) and every action in `publish.yml`, which can publish through npm OIDC, are pinned to full commit SHAs with the release version in a comment. Resolve a pin from the action's own repository; keep it pinned when updating. Other `actions/*` references still use major-version tags.

`.github/dependabot.yml` checks `github-actions` weekly and proposes version updates, including SHA pins, as pull requests against `dev`; npm version updates are outside this configuration. Review and merge these through the release workflow, without automatic merging. GitHub reads the configuration from its default branch (`main`), so it starts working only after the release that brings the file there. `target-branch` applies to version updates; security updates still use the default branch ([Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#target-branch)). The first actual update PR is still [unverified](../unverified/ci.md#pinned-actions-and-dependabot-btn-1132).

### macOS

`.github/workflows/macos.yml` (BTN-730) runs on pushes to `main` and `release/**`, every night at 02:10 UTC and by hand, on `macos-latest`, a cheap layer before a live run on a Mac (BTN-312):

- `test` — install, typecheck, unit tests;
- `e2e` — three shards as in `test.yml`;
- `service` — `service/install.sh` as the runner's user with `EVEN_KEEL_PORT=4799` in the checkout's `.env`, the agent `local.even-keel` in `launchctl list`, `GET /api/state` polled for up to 120 s, then `service/uninstall.sh` and the agent and its plist gone; on a failure the job prints `launchctl print` and the log's tail.

Each job skips its work on a push of Markdown only and on a commit already green, as below.

- **`dev` gets a night, not a push check.** GitHub's Mac runners are scarce in the day: between 14 and 21 UTC a quarter of the runs had a job no runner took (`ci.notTaken`) and the p90 wait for a runner reached 10–12 min, while overnight almost none did ([`verified/ci.md`](../verified/ci.md)). A Mac run on every push held each verdict of `dev` and filed fixes for flaky jobs. A break for the Mac now shows the next morning, with the night's commits to search instead of one push.
- **A red Mac makes `main` and `release/**` red.** On their pushes the GitHub adapter takes every workflow run of a commit (`githubActionsSource`, `verdictOf`), so a red run of this workflow files a fix and stops the session mid-turn, as a red `test.yml` does, and a run at work keeps the verdict pending, so `commands.afterGreen` comes as late. Each job has `timeout-minutes: 20` for a ceiling, `e2e` 30.
- **A slow minute is not a red run; a real failure is** (BTN-1578). The Mac runner is slow at random, and a timed-out test used to stop a session and file an empty fix. The `e2e` step sets `E2E_SLOW_RUNNER: 2` (`test/slow-runner.ts`):
  - `vitest.config.ts` doubles the default `testTimeout` and `hookTimeout`, and every own timeout of `src/e2e/` goes through `scaled(…)` (a test holds it);
  - `retry: { count: 1, condition: TIMED_OUT }` runs once more only a test whose last error is vitest's `Test timed out in …` or `Hook timed out in …` — its own timeout or a `beforeEach`/`afterEach` past its own. An assertion, an exception or a harness wait that ran out of the service's time (`e2e: … did not happen`) is not retried: such a test is red on the first attempt with its error in the log. A `beforeAll` past its timeout fails its suite and is not retried; `src/e2e/` has none;
  - a test that passed only on the retry stays in view: a `RETRIED file > test: Test timed out in …` line at the end of the step's log, a count in the verdict line and `retried` in `.temp/vitest-last.json` (`docs/chain/e2e.md`, "Reading a failed run").

  Linux, Windows, `test` on the Mac and a developer's machine do not set the variable: no retry, the timeouts as written.
- **Manual runs** (`workflow_dispatch`, with a `debug` input that opens a `mxschmitt/action-tmate` shell at the end of `service`, open only to whoever started the run) check the branch they are started on.

### A push of Markdown only

A push that changes only `*.md` outside `plugins/` skips the install, the typecheck and the tests, on any branch a workflow runs on for a push (`test.yml`: `main`, `dev`, `release/**`; `macos.yml`: `main`, `release/**`). `scripts/ci-code-changed.sh`, the first step of each job, diffs the commit before the push (`github.event.before`, fetched at depth 1) with the pushed one, and the later steps run on `code == 'true'`. The run itself still happens and comes out green in seconds. A `paths-ignore` filter would not do: Even Keel waits for a run of every commit it pushes, and a push the CI never takes holds the next launch for `STUCK_MS` and then goes to the project's own check. A pull request, a manual run, a new branch or a `before` the runner cannot fetch run everything.

The cost: the skip trusts the commit before the push. If that one is red and its verdict is never read — the chain stopped waiting for it after `waitMinutes`, then pushed Markdown over it — the push of Markdown comes out green, and the break shows up at the next push with code.

### A commit already green

A push of a commit the same workflow already passed runs no tests (EKR-90): `main` gets no commits of its own, so a release's push of `release/v<x.y>` or `dev` to `main` is a commit that passed on its branch, and so is one branch fast-forwarded to another's commit. Mac runners are scarce ("macOS" above), and `macos.yml` alone is five jobs.

`test.yml` and `macos.yml` start with `already-green` on `ubuntu-latest`: `scripts/ci-already-green.sh` asks `actions/workflows/<file>/runs?head_sha=<sha>&status=success` with the job's token (`permissions: actions: read`) and sets `green` if a run other than this one is there. The other jobs have `needs: already-green` and run only when `green` is not `true`; skipped, they leave the run `success`, which the verdict takes as green (`verdictOf`).

- Only a push is skipped: a pull request, a manual run, an API error run everything.
- A run of the commit from a pull request does not count — it checked the merge with the base, not the commit — nor does one still going or red.
- Two pushes of the same commit at once both run in full: neither has a green run yet.
- Each workflow asks only for its own runs, so a red `macos.yml` beside a green `test.yml` makes the next push of that commit run `macos.yml` again.

Not yet seen on a real push: [`unverified/ci.md`](../unverified/ci.md#a-commit-already-green-pushed-again-ekr-90).

## Polling

Terms: a *push* is a move of the watched branch's ref; the *late watch* (`MainCheck.late`, in memory) keeps watching a push the chain already left unchecked, so a verdict that comes later still counts.

### When the API is asked

`src/service.ts` ticks every watch every 5 s (`CI_TICK_MS`). A tick reads the remote-tracking ref `refs/remotes/<remote>/<branch>` locally — `git push` and `git fetch` (including Even Keel's own `git sync`) move it — and asks the API only when:

- it has never asked (startup);
- the ref moved since the last tick — a push; then for `PUSH_WINDOW_MS` (10 min) until a run of that commit, or one created after the push, shows up;
- a run is unfinished — every `POLL_MS` (15 s);
- the last call failed — every `ERROR_RETRY_MS` (60 s);
- the chain asked for a fresh look (`CiWatch.want`, EKR-88: a fix session found nothing to fix and may have rerun the red commit's runs) — every `POLL_MS` for `WANT_MS` (2 min) after the last ask; the chain asks again on each step while it waits.

The ref is read from the files without spawning git (`remoteHead`, `src/git/remote-head.ts`, BTN-1478): the loose ref, then `packed-refs` (parsed again only when its inode, mtime or size changes), in the common folder of a linked worktree. A spawn holds the event loop for tens of milliseconds on Windows, and every watch reads its ref every tick. Git answers when the files cannot be trusted: no `.git` of its own, a reftable store, a symbolic or unparsed ref, an unreadable file.

A finished run's jobs are not fetched again. GitLab goes through the same `SharedSources`, `POLL_MS` and hidden-CI rules as the other forges.

### What a push brought

What each push of the history brought is read from the project's checkout (`readBrought`, BTN-1586): `git log --format=%P%x09%s <previous push's commit>..<push's commit>`, at most `TASK_COMMITS` commits, the previous push being the next older one of another commit, a run by hand skipped.

- The tasks of the current push are the ids in all those subjects (`CurrentRun.tasks`, what the chain and the fix task name); the subjects of the commits that are no merges go to `CiView.brought` by the push's commit.
- A range is read once and kept while its push is in the history; one git cannot read — the commits not fetched yet — is asked again at the next poll.
- The oldest push of the history has no previous one: its tasks come from its own commit (`-1`) and it has no `brought`.

### Stuck, and a busy runner

`STUCK_MS` (2 min) is when a queued run or a push without a run is called stuck. A CI the project's `ci.kinds` do not name (BTN-707; `CiWatchDeps.counted`) is polled for a push all the same, so a run started by hand shows up, but the push is never shown as waiting for a run or stuck: its workflow may run only by `workflow_dispatch`, as this repository's Forgejo one does.

GitHub Actions and GitLab.com runs start within a second; a self-hosted forge with one shared runner can keep a run queued for minutes while it builds another repository ([`verified/ci.md`](../verified/ci.md)). Two things cover it (BTN-719):

- **A busy runner.** A queued run is not stuck while the runner is busy (`runnerBusy` in `src/ci/verdict.ts`): a run of the same repository at work, or one of any repository the service watches whose CI is of the same kind on the same host (`verdictOf`'s `neighbours`, every watch of every project, counted or not).
- **The late watch.** A push the chain left unchecked because a CI said `ci.notTaken` stays watched: a run taken later decides it — green as any green, red files the fix as any red `main` — until the chain's next push of the project, `LATE_MS` (an hour) or a restart. While it waits the chain asks for a fresh look on each step (`CiWatch.want`), so a rerun of a finished run is seen. The same watch holds a push left unchecked because the CI did not answer (EKR-136) — a request timed out while its run was under way, as GitHub's API does a few times a day: once it answers again, its verdict decides as above, and the panel says the CI did not answer instead of no runner took it (`MainCiView.late.unanswered`). A failed call is still retried every `ERROR_RETRY_MS`; the fresh look does not hurry it.

### A run no runner took

A run no runner took can also come back finished, as a failure. GitHub cancels a job no hosted runner took for about 15 minutes ("The job was not acquired by Runner of type hosted even after multiple attempts": the job's `conclusion` is `cancelled`, its `runner_name` empty, no steps) and then closes the whole run as `failure`; when `macos-latest` runners ran short, this stopped a session and filed an empty fix twice (BTN-761).

- The adapter marks such a job `CiJob.notTaken`. GitLab drops a job no runner took within an hour as failed with `failure_reason: stuck_or_timeout_failure` and no `started_at`, and fails the pipeline — inside the hour of `LATE_MS` — so its adapter marks such a job too. Forgejo has no such outcome within the hour: its job waits for a runner until `ABANDONED_JOB_TIMEOUT` (a day by default) and is then cancelled; its adapter sets no mark.
- `CiWatch` reads the jobs of every failed run of its history once (the current run's jobs are reused; a run that ends anew — a rerun keeps the run's id — is read again; jobs it cannot read leave the run failed and are asked again at the next poll) and marks the run `CiRun.notTaken` when every job that did not pass or was skipped is such a job (`failedUntaken` in `model.ts`).
- `viewVerdict` does not count a marked run as red, and does not take a commit whose runs are over for green while one of them is marked: the commit says `ci.notTaken` and goes to the late watch, and a rerun of the same run gives the real verdict. A run where any job really failed stays red. A marked run is also left out of the median.
- PR mode's poll reads its own runs (`reviewDeps.check` in `src/review/wiring.ts`) and drops such a run of the pull request's head too (BTN-778): after `readFailure` read the jobs of a failed run the session was not told of, a run `failedUntaken` holds for gives no `ci` feedback, and its `failedKey` is kept for that pull request so the next polls neither read its jobs again nor pass it on; a rerun that ends anew is read again, and the keys go when the run leaves the polled list or the pull request is merged or closed. Jobs that cannot be read leave the run as a failure with its link alone. `outcomeOf` skips a run marked `CiRun.notTaken` as well.

### A queued run with jobs at work

Two GitHub traps:

- GitHub sets `run_started_at` when the run is created, before a runner takes it, so a queued GitHub run has no start.
- GitHub keeps a whole run `queued` while any one of its jobs waits for a runner, though the others run or are done (BTN-1576: a macOS run with four jobs over and one at work, only `test` waiting, and the chain called the push unchecked).

So the run's own status is not trusted alone: `CiWatch` reads the jobs of every run of the current push, and `runOfJobs` (`model.ts`) makes a queued run with a job at work or over (not skipped, not given up for want of a runner) `running`, its start the first job's; the history takes the same run. The verdict then waits for it however long, and `ci.notTaken` and the panel's "no runner takes it" stay for a run none of whose jobs got a runner. The adapter gives a job GitHub calls `queued` its `created_at` as `CiJob.waitingSince` (`waiting` and `pending` wait for an approval or a concurrency group, not a runner), and the panel names each job of a run at work that has waited `STUCK_MS` or longer — "test waits for a runner for 8m" (`waitingJobs`), a quiet hint, not the stuck warning. Forgejo and GitLab are expected to sum a run's status from its jobs with one at work first, so the same mixed run should be `running` there already (read from their sources, not checked live); `runOfJobs` covers them all the same, and their adapters set no `waitingSince`.

## Forgejo traps

Checked on Forgejo 16.0.3 (`+gitea-1.22.0`) and code.forgejo.org (17.0-dev):

- With `REQUIRE_SIGNIN` the API is closed without a token.
- The profile's check is `GET /api/v1/user`: a token without the `read:user` scope gets 403 there (`CredentialsRefused`), even when it reads the runs.
- `limit` without `page` is ignored and the whole history comes back — hundreds of MB of `event_payload`. Always send `page=1`.
- Runs and jobs exist, steps do not: the panel lists Forgejo's jobs and links the run page for the steps. A job's times come from `/actions/tasks` (`run_started_at`, `updated_at`) by its `task_id`.
- An unset time is the zero time of Go or of Unix (`0001-01-01`, `1970-01-01`): read as none, and a run's start falls back to `created`.
- The web path of a job's log, `/<owner>/<repo>/actions/runs/<index>/jobs/<n>/logs`, does not take a token (404), and the run number in the page's URL is not the run's id: the log is read through the API ([`layer.md`](layer.md), "The contract"). The whole run's zip at `/actions/runs/<id>/logs` is not used.

## The page

`state.ci` maps a project key to its `CiView[]`. The fake: `?ci=…` in `docs/web/fake-states.md`.

### The badge

The badge (`web/src/pages/CiChip.tsx`, `ci.css`) is the first tab over the side column of the project page, or follows the chain buttons in the project head where there is no column. Its dot is the worst level of the project's counted CIs (`web/src/ci.ts`, `countedViews`; all of them when none is counted), and a running run adds its clock. It opens the side panel at `#ci` (`CiPanel`), a card like the backlog's and the settings', with a framed block per CI (BTN-323).

### The block of a CI

The block's head is its lamp, kind, remote and a quiet ↗ to all runs; the API's health and when it was checked are the lamp's tip. In view are an error, a stuck or push note and the current or last push (BTN-613).

- **A push, not a run** (BTN-828). One push of GitHub starts several workflows with numbers of their own (Tests and macOS on one commit), and the verdict waits for all of them. `CiView.current` is `CurrentRun {commit, title, manual, tasks, runs}`: every run of the newest push (`pushKey` — the commit, a manual run on its own), each with its jobs. The push's state is `pushStatus` (a red run decides, then one at work, then the queue) and its time is that of `leadRun`, the run that ends last.
- **The head of the push.** A status chip only while it is queued or running, then what the push brought (`pushLabel` over `CiView.brought`, BTN-1586): the task keys of its commits, each a link to the task, else the first commit's subject and "+N", "sync" for a push of merges alone, the top commit's title when `brought` has no key for it (a manual run's title is its workflow). The whole line links the run, its tip is the list of commits — so that a push topped by a merge of another machine's work does not read "Merge remote-tracking branch 'origin/dev' into dev".
- **The strip under it.** The commit, the run's number and workflow when the push has one, the events (push, pull request, by hand, on schedule) and who pushed it, split by short dividers; the time apart at its right — "usually 3:10" while queued, a meter "elapsed / usual" while running (amber past the usual), once over the length after a clock ("took 3:12" its tip) and "26 min ago" as two cells (BTN-1378); then the tasks of the push as chain keys when the line above does not name them already, a fix of `main` as a purple tag.
- **Who pushed** (BTN-707): "pushed by the chain" after a task or "pushed by hand" ([`layer.md`](layer.md), "A push by hand") — `MainCiView.pushes`, the latest 50 pushes the service saw, in memory only. A fix of `main`, whose purple tag already says it, has no such segment.
- **Several workflows.** A push of one workflow keeps that run's jobs under it; one of several has a row per workflow — dot, name, number as a link to the run, its own meter — with the workflow's jobs folded under the row, open when it is red. The usual length is per workflow (`CiView.medians`, `mediansOf` over finished runs): one median of Tests and macOS would mislead both.
- **Runs that are not red.** A run with `notTaken` (failed only for want of a runner, BTN-761) is a grey dot and "no runner took it, waiting for a rerun", as the verdict reads it. A queued run whose runner is held — by a run of its own repository or, on a self-hosted forge, of a neighbour of the same kind on the same host (`busyRunner` of `verdict.ts`, set by `ciViews` of `wiring.ts` into `CiView.busy`) — says "runner busy: <repository> #<number>" instead of a bare "queued".
- **Not counted.** A CI outside the project's `ci.kinds` (`CiView.counted` false) is marked "not counted", its lamp grey and still, and stands after the counted ones.
- **A mirror.** A later CI whose current run has the first one's commit and the same finished status — the same push seen by a second forge — is one line: lamp, kind, remote, "same commit" and the length after a clock (`MirrorTime`); it opens into its whole block.

### Jobs and history

The jobs (each job's steps folded under it, open when the job failed or is the only one; a job without steps from the API has a ↗ to the run page) and the history are folds with their statuses as dots in the label; a red run opens its jobs.

The service keeps the last `HISTORY` (20) runs, and the history groups them by push (`pushesOf`). A row is the push's dot, commit, what it brought as the head says it, a dot per workflow when there are several (its name the dot's tip), length and when. The state, events, who pushed it and run numbers are the row's tip — "Status: green", "Event: push", "Pushed: by the chain", "Runs: Tests #41, macOS #186" a line each, then "Commits:" and what it brought (`pushTip`). A manual run is a row of its own. The history shows 5 pushes and "Show all"; opened on a fix (`#ci/<fix>`), it opens on its own, with every push when a marked one is past the first 5.

### What the chain waits for

What the chain waits for on `main` is said in the card it concerns (BTN-829, `web/src/ciHold.ts`). `chainHoldOf` takes the chain's `ciWait` — the CI's verdict, the project's own check (`local`) — or, without one, the late watch (`MainCiView.late`, BTN-719, with the time it ends). `holdPlace` puts the line under the commit strip of the counted CI whose push is at that commit, else beside the "pushed, waiting for a run" hint, else apart at the top of the first card, naming the commit. A card that carries the line never folds into a mirror. A wait for the commands after green has no line of its own (their row says it), and the fix of another project's red `main` is left to the chain's own line.
