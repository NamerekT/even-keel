# Task time, long commands, the classifier

## Task time (BTN-55, `src/turns.ts`)

Active time is by transcript turns, not by a launch timer: this way every session has it (chain, manual, VS Code), retroactively too. Turns are counted over the main session and recomputed, like signs, when a session has a new last row or its key changed (`TURNS_VERSION` and whether there is a launch in Even Keel's log).

### Turns, for every agent

- **A turn** runs from the row that began it to the last response before the next such row. Subagent responses extend the parent's turn and are not added separately. A long tool inside a turn (a build, tests) is work.
- **Its kind**: `launch` — the first prompt of a session started by Even Keel; `resume` — Even Keel's continuation prompt after a limit; `prompt` — the rest. A turn that hit a limit is `limited`.
- **Waiting** is the questions and permissions inside turns plus the gap from the end of a turn to the user's next `prompt`. The gap after a turn cut off by a limit is not waiting, nor are chain pauses and handoff gaps: the next session begins with `launch`, the continuation with `resume`.
- **Per task** (`task_times`): the sums of its sessions (handoffs, checkpoints, "New session"). The total is from the start of the first turn to the end of the last: Tally keeps no Done date.

### Claude

- **A beginning**: a prompt; `notification` — a background task notification or a self-scheduled wake-up (`scheduled_task_fire`); `message` — a message from another session or a background subagent's report. Service rows (`<local-command-…>`, `<system-reminder>`, `[Request interrupted`) and the compaction summary begin nothing. `limited` — a `rate_limit` error or `usageLimitNote`.
- **Questions**: `AskUserQuestion` and `ExitPlanMode` inside a turn, from the call to the result, are waiting (`ask_s`).
- **Permissions** are not visible in the rows, only through `system/turn_duration` (`cli_s`, written only for `entrypoint: cli`, Even Keel's sessions): the CLI counts neither questions nor permission requests into a turn. A turn's active time is the smaller of the turn by rows (without `ask_s`) and `turn_duration`; the difference is waiting. `turn_duration` only bounds the turn: the CLI counts double on background subagent reports (its turn starts anew from the original prompt). VS Code and the desktop app have no `turn_duration`, so there a permission wait stays in active time. The sums agree with the CLI's ([`../verified/page.md`](../verified/page.md)).

### Codex (BTN-469, `src/rollout-turns.ts`)

The same `turns` and `turn_sessions`. `refreshTurns` maps the rollouts found to sessions and reads the plain or compressed file when the session or its parser key (`VERSION` plus the shared turns key) changed; a new key recomputes the sessions collected before on the next run, even with unchanged read marks. A missing source leaves the turns computed before.

- `task_started` begins a turn (`turn_context` or `user_message` when it is missing); `task_complete` or `turn_aborted` ends it. An incomplete turn ends at its last visible response or tool activity, and results after completion do not extend it. Steering messages and compaction do not split a running turn.
- Replies are unique response ids, with the same cumulative-token fallback as loading; assistant items make a reply when usage events are absent. Visible limit errors set `limited`.
- Synchronous `request_user_input` calls and results are question waits (overlaps count once, an unanswered call is bounded by the turn's last activity); `request_user_input_async` is no wait.
- There is no `cli_s`: invisible waits stay in active time. The check on real history is in [`../verified/codex.md`](../verified/codex.md).

### OpenCode and Copilot (BTN-617, `src/opencode-turns.ts`, `src/copilot-turns.ts`)

The same way, each with its own key (`opencode:<VERSION>:…`, `copilot:<VERSION>:…`): `refreshTurns` takes a `TurnSource` per session — every Codex rollout, every non-subagent session of each `opencode.db` (`topSessions`), every Copilot `events.jsonl` — and reads only the sessions whose last row or key moved.

- **OpenCode**: a user message of the session itself with text begins a turn (`turnRows` in the root's `src/opencode/db.ts` joins its text parts; a compaction's message has none). The turn ends at the latest `time.completed` of a response in it, its subagents' included; a reply is a response of the session itself with tokens; `limited` — an API error with status 429 or a limit message.
- **Copilot**: a `user.message` without `agentId` begins a turn, `session.shutdown`/`resume` closes it, and it ends at the last `assistant.*`, `tool.*`, `session.usage_record` or `session.error`; the CLI's `assistant.turn_start`/`turn_end` are model steps inside the turn. A reply is a `session.usage_record` with tokens of the session itself; `limited` — a `session.error` of type `rate_limit`/`quota` or with a limit message.
- In both `ask_s` is 0 (chain sessions do not ask through a tool: OpenCode runs as non-interactive `opencode run`, Copilot with `--no-ask-user`; the live databases hold no question tool call) and `cli_s` null.

### Time reports

- **Huly** (`reportTimes` in `src/huly.ts`): a `TimeSpendReport` per task via `addCollection`, `employee: null`, the value the active hours. Its description is the fixed string `REPORT_DESCRIPTION` of the code, in Russian: "Tally: активное время агента по ходам транскриптов". A report already in Huly with that description stops a second one.
- **Which tasks** (`pendingReports` in `src/db.ts`): done ones, whose first turn is no earlier than `reportsSince` of `tally.config.json` (`null` — reports off), with a minute or more of active time and a last turn older than 60 min. What was written goes into `tasks.reported_h`/`reported_at`.
- **Never rewritten**: a written report is not updated when the task goes on afterwards, nor when a later migration step gives the task less time. Before migration step 23 a manual session that ran a few commands in a task's worktree went wholly to that task, so older reports may hold its hours.
- **GitLab and Jira** (EKR-35) take the same rules through the tracker layer's optional `TaskSource.logTime` (`docs/trackers.md`), not a client of Tally's own. The service hands each run the profiles of trackers whose adapter has `logsTime` (`timeTrackers` in the root's `src/tracker/trackers.ts` → `CollectRun.trackers`), and `reportTrackerTimes` (`src/tracker-times.ts`) gives each pending task no Huly profile reaches to the profile of its id prefix, connecting a tracker only when it has such a task.
  - The time is whole minutes of the same hours (`entryMinutes`, at least one) with the same description.
  - A tracker that refuses time for the task's project (`logTime` → `false`) gets the task marked with `reported_at` and `reported_h` null, needing no report, and one log line per project and run; any other failure ends that profile's batch and the rest waits for the next run.
  - Only `tasks.reported_at` guards against a second write: neither tracker is asked for an earlier entry.
- **GitHub and Linear** have no time tracking and no `logsTime`: their tasks stay pending and are sent nowhere. A run by hand (`npm run tally`) has no profiles and writes to no tracker but Huly.

## Long commands (BTN-56)

How long the agent's long commands take — a Unity check, tests, a build, a merge — and whether they have become slower (`src/step-runs.ts`, `refreshSteps` in `src/steps.ts`). Tally calls such a command's kind a step. A run is a `Bash`/`PowerShell` call of the main session or a subagent; runs are recomputed, like signs, when a session has a new last row or the key changed (`STEPS_VERSION` and the rules).

- **The end of a run.** An ordinary call ends at its result. A background one (`run_in_background`, or gone to the background) ends at a `<task-notification>` by `tool-use-id` or task id (the outcome by its status), else at `TaskStop`/`KillShell` (`killed`), else at the last poll; otherwise it stays open (`end_by` `open`, up to the call's result). A detached one (`&` at the end, `Start-Process` without `-Wait`, `Start-Job`, `nohup`) likewise ends by polls.
- **A poll** is `TaskOutput`/`BashOutput` by id, a `Read` of the output file or of a log from the command, a command with its name, or a bare `sleep`/`Start-Sleep` while a run is open; polls are the run's `polls` counter, not runs of their own. The outcome: `fail`, `timeout` (`timed out`, `no exit after`), `killed` (interrupted, stopped).
- **The step** is the first rule that at least one segment of the command matches (split by `\n`, `;`, `&&`, `||`, `|`): the project's own rules, then the common ones. The defaults (`DEFAULT_STEPS`) are `unity-check`, `unity-batch`, `vitest`, `dotnet-test`, `build`, `git-merge`; projects have none of their own. `steps` in `tally.config.json`: `rules`, `projects.<project>` (over the defaults, `null` removes a rule), `slowSeconds` (60, the threshold of "> 60 s"), `growth` (`ratio` 1.5, `minRuns` 5, `minSeconds` 10). Without a rule the run has a `signature`: the program and the first word (`npm run x` — two), without assignments and `cd`; Even Keel shows such commands the same way.
- **A cold run** is the first of its step in a place (`place`: a worktree, or a folder and a branch): a new worktree, or a slot switched to another branch. A cold Unity check takes several times a warm one.
- **Tables**: `step_runs` (a run: step, signature, command up to 300 characters, start, end, mode, how it ended, outcome, place, polls) and `step_sessions`. Views: `step_runs_x` (with `cold`, task, project), `step_weeks` (per project, step and UTC week: count, p50, p90, max, cold, failed) and `step_growth` (a week against the previous one with runs: `grew_p50`/`grew_p90`, the thresholds from `tally_meta` `steps`, which every run writes). A check against the transcripts is in [`../verified/page.md`](../verified/page.md).

## The classifier (`src/classify.ts`)

A span's reason comes from Gemini on the free tier through your own LiteLLM proxy: `POST <TALLY_LLM_URL>/chat/completions` with the key `TALLY_LLM_KEY` (the LiteLLM master key), `temperature: 0`, `response_format: json_object`. No URL or key — the classifier is skipped with a line in the log.

- **The model** is `TALLY_LLM_MODEL`, by default `google-gemini-3.1-flash-lite`, chosen by comparison with the earlier classifier ([`../verified/page.md`](../verified/page.md)). On a refusal LiteLLM goes down its own `router_settings.fallbacks` (`google-gemini-3.5-flash-lite`, `google-gemma-4-26b-a4b-it`), and the one that answered is written to `span_reasons.model` and to the spend. The free quota is per model, so the chain does not start with models other projects spend on the same key (`google-gemini-3.6-flash` and below).
- **The prompt** has the task, the span's signs and an excerpt: the span's events and the last prompt before it; over 120 events — the first 40, "… N events skipped …", the last 80. The answer is awaited for up to 3 min.
- **The answer**: one of `unclear_task`, `broken_tooling`, `debug_loop`, `waiting_user`, `limit_env`, `normal`, `other`, and an explanation the prompt asks for in Russian (fixed in the code). An answer that does not parse gives `other` with its text as the explanation. LiteLLM's error (the whole chain refused) — a line in the log, and the classifier waits for the next run.
- **Which spans**: of sessions silent for `classify.idleMinutes` (60) and active no earlier than `classify.sinceDays` (14) days ago, newest first, at most `classify.perRun` (10) per run; `perRun: 0` turns it off. A span with a reason is not classified again; `prompt_version` (`PROMPT_VERSION`) is stored with it. Spans of `prompt_version` 1 were classified by Haiku through `claude -p`, until 2026-10-03.
- **The spend** is a row in `messages` (`message_id` `tally-classify:<response id>:<model>`, account `litellm`, the project and folder of the Even Keel repository, `entrypoint` `tally-classify`), in the transaction of the reason. The prices of `google-gemini`/`google-gemma` in `tally.config.json` are 0: free tier, tokens visible, money not. LiteLLM sometimes answers with the model's name without `google-` (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`): each such name gets its own key at 0, never a bare `gemini-` prefix, which would also price Copilot's and OpenCode's paid Gemini at 0.

## Other LiteLLM spend

Two more features use the classifier's LiteLLM URL, key and free-tier prices; their usage goes through Even Keel's ledger `badge_translation_spend` into `messages` (`collect.ts`, account `litellm`, the classifier's project and folder), and a ledger row can be replayed without duplicates after a failed run or after Tally is turned on again.

- **The README badge's title translations** (`entrypoint: badge-translate`, the root's `src/badge/translate.ts`), a response with an unusable title too: [`docs/badge.md`](../badge.md). Task descriptions and comments are never sent.
- **The chat microphone** (BTN-1391, the root's `src/dictation/transcribe.ts`): its own model `TALLY_LLM_DICTATION_MODEL`, by default `google-gemini-3.5-flash-lite` — the classifier's first fallback rather than its first model, since the free quota is per model and per day. One recording is one request, `entrypoint: chat-dictation` (`message_id` `chat-dictation:<uuid>:<model>`), so `/stats` shows how many requests dictation takes. LiteLLM's 429 (the whole fallback chain refused) is the notice `dictation.quota`, and the page uses the browser's recognition for an hour. The page sends what the browser recorded: Opus in WebM and AAC in MP4 both go as a `file` part, and WAV did worse on English terms in a Russian phrase ([`../verified/page.md`](../verified/page.md)).
