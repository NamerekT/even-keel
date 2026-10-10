# checkpoint

A hook that keeps long sessions cheap. Every turn re-reads the whole context, so a session that goes through a loop of checks (test runs, debugging, screenshots) or the wrap-up (docs, review, merge) with a big context pays for it again and again. A fresh session that starts from a short note costs a fraction of that.

After every tool call the hook reads the size of the main thread's context from the transcript. When it passes **200k tokens**, again every **50k** after that and every **25k** past **250k**, the hook tells the session how big the context is and asks it to make a checkpoint: write `.temp/handoff.md` at the root of the working tree (what is done, what is left, hypotheses, what was ruled out, the files that matter, the exact next command) and end its turn with the line

```
CHECKPOINT: .temp/handoff.md
```

The first nudge lets the session pick the moment: before a loop of checks or the wrap-up, not in the middle of a change that does not build yet or of a step that needs what is loaded. Sessions used that last clause to carry on through every nudge, so the later ones drop it: checkpoint now or as soon as the current change builds, unless all that is left is the merge and the final report. Subagents are not nudged.

Sessions sometimes write the note and then close the turn with a report, without the line. A second hook, on `Stop`, catches that: if `.temp/handoff.md` was written or edited among the last three tool calls of the turn and the last line of the last message is not the mark, it sends the session back to reply with the line alone. It asks once per stop, so a session that still refuses is let go.

The first threshold is a matter of money, not of the window. A handoff is not free: the old session writes the note, and the new one reads the code again before its first edit, writing it into the cache at forty times the price of re-reading it — on our tasks about a dollar together. Asked for at 150k, most handoffs cost more than the shorter context saved; hence 200k.

With Even Keel running, the hook asks it about its session once the context reaches 100k (`EVEN_KEEL_URL`, by default `http://127.0.0.1:4747`) and gets two things for a session of a chain:

- **the project's threshold** — calibrated from the project's own statistics once it has enough handoffs, or pinned with `stats.checkpointTokens` in Even Keel's config; the `/stats` page shows the number and where it comes from;
- **how many handoffs the task has had** — after the third the hook stays silent until the context reaches **300k**: on tasks handed over again and again most handoffs lose money.

Without Even Keel, or in a session it did not start, the hook works on the numbers below and there is no limit of handoffs. An answer is kept for an hour, a failed request is tried again in five minutes, and a session never waits for it longer than two seconds.

Even Keel takes it from there: it stops the session and starts a new one in the same worktree with a handoff prompt that points at the note (see "Handoffs" in the [main README](../../README.md)). Outside a chain the line is just the end of a turn — start a new session yourself and give it the note.

## Install

User scope — the hook is useful in every project, not only in chains:

```bash
claude plugin marketplace add <git URL or local path of this repository>
claude plugin install checkpoint@even-keel --scope user
```

Keep `.temp/` in the project's `.gitignore`, or the note ends up in a commit.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `CHECKPOINT_FIRST_TOKENS` | `200000` | context size of the first nudge; a calibrated or pinned threshold from Even Keel outranks it |
| `CHECKPOINT_STEP_TOKENS` | `50000` | a new nudge every this many tokens after the first |
| `CHECKPOINT_LATE_TOKENS` | `250000` | from this context size on, nudges come more often |
| `CHECKPOINT_LATE_STEP_TOKENS` | `25000` | a new nudge every this many tokens past `CHECKPOINT_LATE_TOKENS` |
| `CHECKPOINT_HARD_TOKENS` | `300000` | context size of the first nudge for a task that has had its handoffs |
| `CHECKPOINT_MAX_HANDOFFS` | `3` | handoffs of a task after which nudges wait for `CHECKPOINT_HARD_TOKENS` |
| `EVEN_KEEL_URL` | `http://127.0.0.1:4747` | where the hook asks Even Keel |

Put them into the `env` of `~/.claude/settings.json`. Set the first nudge well below the size where the CLI compacts the context. A step that would land less than a late step before `CHECKPOINT_LATE_TOKENS` is skipped, so two nudges do not come one right after the other.

The hook remembers the last nudge per session in `claude-context-checkpoint/` under the system temp folder. After a compaction drops the context below the first threshold, the next nudge counts as the first again.
