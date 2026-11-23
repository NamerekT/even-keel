# Compaction versus handoff: protocol fixed before the first assignment

Protocol date: 2026-10-29. This follows the [week-to-week comparison](compaction-week.md).
No result is reported here. These rules were committed as `962fda25` before the first live assignment;
the UTC start time and assignment log are recorded below. The rules have not changed after that run.

## Assignment and population

The script, not a person or a page button, assigns every open task of the selected tracker projects:
an **even task number means compaction**, an **odd number means handoff**. Both groups receive explicit labels:
`Break | compaction` and `Break | handoff`. The initial project is BTN.
Backlog and parent tasks are included; Done and Canceled are not. Selection does not depend on model,
estimate, priority, milestone, task length or the result of a session. Analysis uses only closed tasks
whose agent sessions are all Claude; tasks with another provider remain in the assignment log but are
outside that analysis population. Report the provider exclusion count.

Any existing break label stays, including the wrong label or both labels. Each run logs the task ID,
number, actual label(s), expected label, action and UTC time as JSON lines. A repeat run makes no writes
for already labelled tasks. The script re-reads each task before writing; the tracker has no atomic
compare-and-set, so do not run overlapping copies or edit break labels during assignment.

## Common conditions

- `autoCompactWindow` is 250000 in all four Claude account folders used by the chain, verified on
  2026-10-28 before this experiment. The experiment does not change account settings.
- Handoff calibration and the product's context shares stay as implemented: first/late/hard 72/85/95,
  with Claude's `COMPACTION_GAP` of 32000 and the product's space before compaction for writing the note.
  The global `stats.checkpointTokens` override was cleared to null on 2026-10-28. The compaction label
  supplies 999999; the handoff label uses ordinary calibration and window limits.
- Holding a task after its third handoff is unchanged. See [checkpoint thresholds](../sessions/checkpoint.md#checkpoint-threshold-btn-86).
- Product and CLI changes are not frozen. Record them; use the version strata below rather than
  comparing an earlier week with a later week.

## Count by assignment, including deviations

A task belongs to the group given by its number for its whole lifetime, whatever actually happens.
A handoff-assigned task compacted by the CLI stays in the handoff group and also gets its own deviation
row. Never move tasks between groups after seeing their outcomes.

Keep a deviation ledger with task, parity group, first session start, first observed assignment time,
actual labels, CLI version(s), and reason. At minimum record:

- a session started before its task received the script's label (including tasks already running at rollout);
- a wrong existing label, both labels, or any later manual label change;
- CLI auto-compaction in the handoff group, and context handoffs in the compaction group;
- a change of CLI version within a task, unknown version, or a changed common condition.

These tasks stay in the primary assigned-group totals. Missing assignment evidence is a deviation,
not permission to discard a task. Preserve the first successful `assigned` log line; a later `existing`
line does not establish when the label was first applied. Pre-existing labels have unknown assignment
time unless separate evidence establishes it. Keep logs outside git and retain them through analysis.

## Outcomes and stopping rule

Use the definitions and formulas of [compaction-week.sql](compaction-week.sql): API-equivalent cost per
1000 output tokens, main-agent cost per request, mean main-agent context, breaks per task, real stuck
spans per task, share of tasks with a real stuck span, active minutes per 1000 output tokens, median
task cost and active minutes, total cost, and compaction pre/post context and duration. Count real stuck
spans only for `broken_tooling`, `debug_loop`, `unclear_task`, `other`. Add the deviation counts above.
Include subagent output and cost as in that SQL; main-request metrics stay main-agent-only.

A **long task** has at least one context handoff or main-agent automatic compaction, in either group;
tasks with neither are the short control population. Relays for unrelated reasons alone do not make a
task long. Stop the primary collection at the first completed assignment sweep where both groups have
at least **30 closed long tasks**. Include all eligible tasks completed by that sweep, including any
overshoot, and report short controls separately. Do not publish interim outcome numbers or stop early.

Compute each metric inside CLI-version strata first (`line_raws.raw->>'version'`). For task-level metrics,
fix the stratum to the first main Claude assistant line's version in that task; a version change stays
in that stratum and is additionally a deviation. Session and compaction metrics use their own session's
version. Calculate the unweighted mean of the per-version group differences over versions represented
in both groups, and show each stratum's counts and metrics. Versions present in only one group and
unknown versions remain visible in separate rows and assigned-group totals; they do not silently
enter a matched version comparison. Keep model-family counts visible within each stratum.

Known bias **in favour of compaction**: the summary call is absent from the transcript and therefore
has no priced cost. Report `compactions.duration_ms` as the available estimate of that missing work's
time; do not pretend it estimates dollars.

## Running and scheduling

From a source checkout with dependencies installed:

```powershell
npm run break-labels -- --dry-run BTN
npm run break-labels -- BTN
# Several projects, or a project GUID when keys are ambiguous:
npm run break-labels -- BTN EKR
```

The script reads the installation's settings and tracker profiles through `readStateDatabase`, not
the old imported config file. In a worktree, set `EVEN_KEEL_DATA` to the installation's data folder
(or `EVEN_KEEL_STATE_DIR` to its state folder). It calls only `src/tracker/` contracts: the same
selection works for Huly, GitHub, Linear and other adapters with `relabel`. It adds no service function
and no page control. A failure exits nonzero; earlier successful writes stay and a retry preserves them.

The user registers the schedule. This PowerShell example runs every 15 minutes under the registering
user, from the installation's source checkout, with one instance at a time and an append-only UTF-8 log,
and stops repeating after 21 days so a forgotten experiment does not label tasks forever.
`conhost.exe --headless` keeps a console window from flashing up on every run; `Out-File -Encoding utf8`
keeps the log readable by `grep` (Windows PowerShell's `*>>` writes UTF-16).
Replace the example folder; use the identity that can read the installation's state and profiles.

```powershell
$repo = 'C:\Projects\even-keel'
New-Item -ItemType Directory -Force -Path (Join-Path $repo '.temp') | Out-Null
$node = (Get-Command node.exe).Source
$command = "& '$node' 'node_modules/tsx/dist/cli.mjs' 'scripts/break-labels.ts' BTN 2>&1 | Out-File -Append -Encoding utf8 '.temp/break-labels.log'; exit `$LASTEXITCODE"
$psArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $command + '"'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless powershell.exe ' + $psArgs) -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 21)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'EvenKeel-BreakLabels' -Action $action -Trigger $trigger -Settings $settings
```

At the stop rule, `Unregister-ScheduledTask -TaskName 'EvenKeel-BreakLabels' -Confirm:$false`.
For a separate data folder, add `$env:EVEN_KEEL_DATA = 'C:\Data\even-keel';` to the command.
No task is registered by the script. On other systems, run the same command every 15 minutes with
the scheduler's overlap prevention and append stdout/stderr to a retained log. The Windows schedule is
[checked live](../verified/sessions.md); other systems' schedulers were never checked. The script is
removed since 2026-11-23 (see the amendment of that date): these commands stay as the record.

## First run record

First live run: **2026-10-29 07:54:08.847 UTC**, `npm run break-labels -- BTN`, using protocol/code
commit `962fda25` and the running installation's data folder. It assigned 78 open tasks and finished
at 07:54:21.861 UTC. The repeat started at 07:54:57.442 UTC: 78 existing assignments, zero writes,
zero parity mismatches. This is assignment verification, not an interim outcome comparison.

Retained outside git in the main checkout: `.temp/btn-505/preview.log`, `first-run.log`,
`repeat-run.log`. Each successful assignment has its own timestamp. A read-only snapshot of the state
database's launch history is retained as `rollout-deviations.json` with its helper script; it records
two tasks that had already started before assignment, across all providers. Apply the Claude-only
population rule during analysis, without losing these rollout records. Preserve these files for the
deviation ledger: any task session started before its assignment is a rollout deviation even though
the label now matches parity. Scheduler registration remains for the user.

The `.temp/btn-505/` files named above are gone: the main checkout's `.temp/` was emptied on 2026-10-30
(BTN-503). The first run's counts above are all that is left of them.

## Second start record

**The first run is void as an experiment.** The schedule was never registered: the script ran only by
hand, on 2026-10-29 and 2026-11-07, so tasks created between those runs and after the second one were
started without any break label. On 2026-11-12 only 9 of 38 and 6 of 38 closed long tasks of the two
groups carried their label, and the rest ran on the product's default, context handoffs. Counting them by parity would
compare two mostly untreated groups. No outcome numbers of that period are reported; the rules above
stay unchanged.

Second start: **2026-11-12 13:14:16 UTC**, the same script (`962fda25`, unchanged since) by hand on BTN.
It finished at 13:14:31 UTC: 87 tasks assigned, 55 already labelled, one parity mismatch kept as it is
(BTN-796 carries `Break | handoff` while even) and recorded as a deviation. Log:
`.temp/break-labels-2026-11-12.log` in the main checkout.

Right after it the schedule above was registered on the author's workstation (every 15 minutes, expiring
on 2026-12-03); its runs append to `.temp/break-labels.log`. The new collection counts only tasks whose
first session started after 13:14:16 UTC; a task first started earlier belongs to the void period and
stays out, whatever its label. The stop rule
is unchanged: 30 closed long tasks in each group, then unregister the task.

## Amendment of 2026-11-17

Written at about 16:30 UTC, before any outcome of the second start was computed. Looked at by then:
group sizes, peak contexts and deviation counts, nothing else.

**The long-task population is biased by the treatment.** A context handoff fires at a task peak of about
160–180k, an auto-compaction at about 215k. A handoff-arm task therefore becomes "long" at a smaller size
than a compaction-arm one, and the compaction arm keeps tasks of the same size among its "short" ones:
of the closed Claude tasks so far, 20 of 94 are long in the compaction arm and 28 of 99 in the handoff arm,
while 24 short compaction-arm tasks peaked above 150k against 10 short handoff-arm ones. Long against long
compares big tasks with big and middle ones together. More tasks do not fix that, so:

- **The primary comparison is every closed Claude task by its number's parity**, long or short. Assignment
  does not depend on anything the treatment does, so the arms stay comparable. The metrics, the CLI-version
  strata and the deviation counts are the ones above.
- Long and short tasks stay as a secondary split, reported with this bias named.

**The stopping rule is replaced by a change of a common condition.** On 2026-11-17 the project's prompt
cache for chain sessions went from one hour to five minutes (Even Keel's `cacheTtl` project setting). The
first BTN chain session writing the five-minute cache is BTN-1051's, started 2026-11-17 15:25:04.578 UTC.

- **Phase 1**: tasks first started 2026-11-12 13:14:16 .. 2026-11-17 15:25:04.578 UTC, under the one-hour
  cache. Analysed now, on the tasks closed by the analysis; the ones still open are counted.
- **Phase 2**: the same assignment goes on under the five-minute cache; the schedule stays until it expires
  on 2026-12-03, then all closed phase-2 tasks are analysed the same way, and the cache becomes one more
  stratum beside the CLI version. A phase-1 task with sessions after the switch is a deviation.

The queries are [compaction-ab.sql](compaction-ab.sql). The rollout deviations (a task first started
before its label's `assigned` line) come from the label logs and are counted outside Tally.

## Phase 1 result

Computed 2026-11-17 ~16:45 UTC, after the amendment was committed (`05ad9aad`).

**Population.** 211 closed tasks (102 even, 109 odd), one even task still open. 18 ran another provider in
some session and are out (8 and 10), leaving **94 compaction-arm and 99 handoff-arm Claude tasks**;
78 and 84 of them Opus.

**Primary, every closed Claude task by parity:**

| Arm | Tasks | $/1k output | $/request | Avg context | Active min/1k output | Median task | Real stuck spans/task | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| compaction | 94 | 0.100 | 0.059 | 113k | 0.414 | $2.72, 14 min | 0.03 | $389 |
| handoff | 99 | 0.099 | 0.056 | 102k | 0.409 | $2.52, 11 min | 0.06 | $427 |

Inside CLI-version strata (2.1.322, .323, .325, .326 in both arms, 192 tasks; 2.1.319 has one handoff task),
the unweighted mean difference compaction − handoff is +0.002 $/1k output (+2 %), +$0.006 a request,
+14k context, −0.01 stuck spans a task, +0.006 active min/1k output (+1.5 %). The strata disagree in sign
on $/1k output: the two largest (2.1.323 and 2.1.325, 153 tasks) have compaction 0.003 cheaper, the two
small ones (2.1.322 and 2.1.326, 39 tasks) 0.008–0.009 dearer, so the mean rests on the small strata.

Breaks per task: compaction arm 0.23 auto-compactions and 0.06 handoffs; handoff arm 0.38 handoffs and
0.09 auto-compactions. Auto-compaction fired at a median 217–218k in both arms; its unpriced summary call
took a median 14 s in the compaction arm (22 calls, 9 min in all) and 63 s in the handoff arm (9 calls).

**Secondary, biased against compaction (see the amendment):** long tasks 20 vs 28 — $/1k output 0.103 vs
0.099, context 129k vs 111k, active min/1k output 0.360 vs 0.366, median $9.78 vs $7.51 at an average
peak of 210k vs 182k; short tasks 68 vs 65 — 0.097 vs 0.098.

**Deviations.** Compaction arm: 1 task with the handoff label, 4 tasks with context handoffs, 1 CLI version
change within a task. Handoff arm: 3 tasks with the compaction label, 6 tasks never labelled (none in either
log: they ran on the default, handoffs), 4 tasks with auto-compactions, 1 CLI version change. From the logs:
28 tasks (15 even, 13 odd) were first started 0–21 minutes before their `assigned` line, between two sweeps
of the 15-minute schedule; an even one among them may have started on the default handoffs. 8 tasks carry
their label only as `existing`, with no `assigned` line in either log.

**Reading.** Per unit of work the two arms are level: about 1–2 % apart on cost and on active time, with
the version strata disagreeing in sign and the bigger ones on compaction's side. Compaction runs with a fatter context (+11–14k on average) and
does not pay for it per output token at this sample; the summary call is still unpriced. Stuck spans are
too rare (3–6 tasks an arm) to say anything. Phase 2 goes on under the five-minute cache.

## Amendment of 2026-11-23

**The assignment stopped early.** The plan kept the schedule until it expired on 2026-12-03; the user
ended it on 2026-11-22, when the project left Huly. The last successful run was 2026-11-22 01:01 UTC;
from 01:16 UTC every run failed, mostly with `No tracker profile for BTN`, so tasks created after
01:01 UTC carry no break label. The scheduled task `EvenKeel-BreakLabels` was unregistered on 2026-11-22
at about 14:10 UTC, and the script (`scripts/break-labels.ts`, `npm run break-labels`) was removed from
the repository on 2026-11-23 (BTN-1495). The commands above stay as the history of the protocol; they
run only from a commit before the removal.
