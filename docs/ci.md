# CI

Even Keel watches the CI of each project and shows it on the page. Watching only: the chain neither waits for a run nor reacts to a red one (BTN-102; waiting and the reaction are later tasks).

## The layer

`src/ci/` is separate from the tracker layer and knows nothing of tasks beyond the `[KEY-N]` ids in commit subjects.

| File | What is in it |
| --- | --- |
| `model.ts` | the neutral model (`CiRun`, `CiJob`, `CiStep`, `CiView`), the adapter contract `CiSource`, `STUCK_MS`, the run length, the median, the current run, `stuckSince`, `taskIdsOf` |
| `remote.ts` | `parseRemote` (https, ssh and scp forms), `ciTargets`: which remote gets which CI |
| `forgejo.ts`, `github.ts` | the two adapters |
| `http.ts` | `getJson` and its notices `ci.denied`, `ci.http`, `ci.unreachable` |
| `adapters.ts` | `CI_TOKENS`, `ciVariables` (kept out of the sessions' environment by `AccountHomes.envOf`), `ciSource`, `projectTargets` |
| `watcher.ts` | `CiWatch`, one per CI of a repository |

The contract is two calls: `runs(limit)` — the latest runs, newest first; `jobs(run)` — the jobs of a run with their steps when the CI gives them.

## Which CI a project has

Read once at startup from `git config --get-regexp ^remote\..*\.url$` and the workflow folders of the project's checkout; a new remote or a first workflow needs a restart.

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

`state.ci` maps a project key to its `CiView[]`. The badge (`web/src/pages/CiChip.tsx`, `ci.css`) sits after the chain status in the project head: its dot is the worst level of the project's CIs (`web/src/ci.ts`), and a running run adds its clock. The panel shows each CI's health, a stuck or push note, the current or last run with tasks, jobs and steps against the median of finished runs, and the history. On screens under 760 px it hangs from the whole head. The fake: `?ci=…` in `docs/web.md`.
