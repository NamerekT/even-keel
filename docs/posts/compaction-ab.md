# Compaction versus handoff: protocol fixed before the first assignment

Protocol date: 2026-10-29. This follows the [week-to-week comparison](compaction-week.md).
No result is reported here. These rules were committed as `a4a280c2` before the first live assignment;
the UTC start time and assignment log are recorded below. The rules have not changed after that run.

## Assignment and population

The script, not a person or a page button, assigns every open task of the selected tracker projects:
an **even task number means compaction**, an **odd number means handoff**. Both groups receive explicit labels:
`Разрыв | компакция` and `Разрыв | хендофф`. The initial project is BTN.
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
- Holding a task after its third handoff is unchanged. See [checkpoint thresholds](../sessions.md#checkpoint-threshold-btn-86).
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

Compute each metric inside CLI-version strata first (`lines.raw->>'version'`). For task-level metrics,
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

The user registers the schedule. This PowerShell example runs every five minutes under the registering
user, from the installation's source checkout, with one instance at a time and an append-only local log.
Replace the example folder; use the identity that can read the installation's state and profiles.

```powershell
$repo = 'C:\Projects\even-keel'
New-Item -ItemType Directory -Force -Path (Join-Path $repo '.temp') | Out-Null
$node = (Get-Command node.exe).Source
$command = "& '$node' 'node_modules/tsx/dist/cli.mjs' 'scripts/break-labels.ts' BTN *>> '.temp/break-labels.log'; exit `$LASTEXITCODE"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -Command "' + $command + '"') -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'EvenKeel-BreakLabels' -Action $action -Trigger $trigger -Settings $settings
```

For a separate data folder, add `$env:EVEN_KEEL_DATA = 'C:\Data\even-keel';` to the command.
No task is registered by the script. On other systems, run the same command every five minutes with
the scheduler's overlap prevention and append stdout/stderr to a retained log. Scheduler registration
and execution are a separate [live check](../unverified.md#scheduled-break-label-assignment).

## First run record

First live run: **2026-10-29 07:54:08.847 UTC**, `npm run break-labels -- BTN`, using protocol/code
commit `a4a280c2` and the running installation's data folder. It assigned 78 open tasks and finished
at 07:54:21.861 UTC. The repeat started at 07:54:57.442 UTC: 78 existing assignments, zero writes,
zero parity mismatches. This is assignment verification, not an interim outcome comparison.

Retained outside git in the main checkout: `.temp/btn-505/preview.log`, `first-run.log`,
`repeat-run.log`. Each successful assignment has its own timestamp. A read-only snapshot of the state
database's launch history is retained as `rollout-deviations.json` with its helper script; it records
two tasks that had already started before assignment, across all providers. Apply the Claude-only
population rule during analysis, without losing these rollout records. Preserve these files for the
deviation ledger: any task session started before its assignment is a rollout deviation even though
the label now matches parity. Scheduler registration remains for the user.
