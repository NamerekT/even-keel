<!--
The compaction week post (BTN-258): the numbers promised in the release post and on LinkedIn ("the numbers go
into the next post, with the queries again"). Public on purpose: numbers and queries only; the analysis on a
bigger sample (the task label of BTN-444) is for Patreon "Behind the build". Not published from here.

Before posting:
- re-run docs/posts/compaction-week.sql; every number below comes from it, and closed tasks still trickle into
  the week's window (31 long compaction tasks on 2026-10-26, 32 on 2026-10-27);
- the switch and the task label in the last section are on dev: say "the next version" until v0.2 is out.

Where to post, in this order:
1. LinkedIn — the whole post, then a reply under the 2026-10-21 post to the commenter it was promised to;
2. Patreon — a free post in the collection "Even Keel";
3. r/ClaudeCode — once the account may post; numbers first, Even Keel only as the footnote it is here.
-->

# A week of auto-compaction against a week of handoffs: the numbers, and why they don't settle it

**TL;DR:** per unit of work it came out even. Long tasks on auto-compaction cost 12 % more per 1k output tokens than long tasks on handoffs the week before, and tasks that never needed either rose by the same 12 % over the same days. Too much else changed that week to call a winner, so the comparison now runs per task instead of per week.

## The setup

Even Keel runs Claude Code sessions one task after another from an issue tracker. Until 2026-10-19 a session nearing ~150k of context was asked to write a handoff note and a fresh session went on from it. From 2026-10-19 20:34 UTC to 2026-10-26 19:00 the handoffs by context were off and the CLI compacted on its own, with `autoCompactWindow` at 250000.

The sample: one project, closed tasks, Claude Opus only, costs at API prices (the subscription bill is flat). A **long** task had at least one break, a handoff before or a compaction during the week. A **short** task had none: it is the control, which saw every other change of the same days. The summary call of a compaction is not in the transcript, so it is not priced here.

## The numbers

| | long, handoffs | long, compaction | short, before | short, during |
| --- | ---: | ---: | ---: | ---: |
| tasks | 42 | 32 | 81 | 81 |
| $ per 1k output tokens | 0.083 | 0.093 | 0.085 | 0.095 |
| $ per request | 0.055 | 0.058 | 0.050 | 0.049 |
| average context | 123k | 135k | 103k | 109k |
| breaks per task | 1.5 handoffs | 1.7 compactions | — | — |
| active minutes per 1k output | 0.230 | 0.274 | 0.272 | 0.305 |
| median task | $9.84, 28 min | $9.67, 30 min | $2.57, 8 min | $2.22, 7 min |
| stuck spans per task | 0.43 | 0.41 | 0.22 | 0.09 |
| tasks with a stuck span | 26 % | 16 % | 14 % | 7 % |

A stuck span is a stretch where the session went in circles: a broken tool, a debug loop, an unclear task. Spans the detector drew only because a compaction happened are left out, since a compaction is one of its signs.

Where the compaction fired: 57 auto-compactions, median 218k of context before (216k to 228k), 19k after, 65 seconds each. With a 250k window that is ~32k early, every time.

## What else changed that week

- The CLI went 2.1.303 → 2.1.306 and 2.1.308 (10-22) → 2.1.309 and 2.1.310 (10-23).
- The median first request of a session grew from 32–34k to 39–40k (10-23, 10-24): a bigger project CLAUDE.md and new hooks.
- The handoff plugin's manifest was broken for most of 10-23, so some sessions ran without its hooks.
- Settings and skills were trimmed on 10-24, and another agent took part of the tasks from 10-23.

On a narrow window before most of that (handoffs 10-16…10-19 against compaction 10-19…10-22), long tasks rose 11 % per 1k output (0.085 → 0.094) against the control's 2 % (0.087 → 0.089). That window has 9 long compaction tasks.

## What came of it

A week against a week can't separate the change from everything around it. So the next version of Even Keel has a switch per project, **Handoffs by context size**, and a task label that sends one task to compaction while its neighbours run on handoffs, the same days on the same CLI. My own pick for now: handoff notes for the unattended chain, auto-compact in the sessions I run by hand.

The queries behind every number above: [compaction-week.sql](compaction-week.sql), run against Tally, the statistics collector inside [Even Keel](https://github.com/NamerekT/even-keel).
