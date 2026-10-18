# checkpoint

A hook that keeps long sessions cheap. Every turn re-reads the whole context, so a session that goes through a loop of checks (test runs, debugging, screenshots) or the wrap-up (docs, review, merge) with a big context pays for it again and again. A fresh session that starts from a short note costs a fraction of that.

The hooks work in Even Keel's chain sessions of Claude Code and Codex: they read no transcript and ask Even Keel, which reads both agents' (`EVEN_KEEL_URL`, by default `http://127.0.0.1:4747`). A session Even Keel did not start, or no Even Keel at all, and they stay silent.

After every tool call the hook asks Even Keel for the size of the main thread's context. When it passes **200k tokens**, again every **50k** after that and every **25k** past **250k**, the hook tells the session how big the context is and asks it to make a checkpoint: write `.temp/handoff.md` at the root of the working tree (what is done, what is left, hypotheses, what was ruled out, the files that matter, the exact next command) and end its turn with the line

```
CHECKPOINT: .temp/handoff.md
```

The first nudge lets the session pick the moment: before a loop of checks or the wrap-up, not in the middle of a change that does not build yet or of a step that needs what is loaded. Sessions used that last clause to carry on through every nudge, so the later ones drop it: checkpoint now or as soon as the current change builds, unless all that is left is the merge and the final report. Subagents are not nudged.

Sessions sometimes write the note and then close the turn with a report, without the line. A second hook, on `Stop`, catches that: if the last line of the last message is not the mark and Even Keel says `.temp/handoff.md` was written or edited among the last three tool calls of the turn (`/api/sessions/<id>/note`), it sends the session back to reply with the line alone. It asks once per stop, so a session that still refuses is let go.

The first threshold is a matter of money, not of the window. A handoff is not free: the old session writes the note, and the new one reads the code again before its first edit, writing it into the cache at forty times the price of re-reading it — on our tasks about a dollar together. Asked for at 150k, most handoffs cost more than the shorter context saved; hence 200k.

Along with the context, Even Keel gives two more things for a session of a chain:

- **the project's threshold** — calibrated from the project's own statistics once it has enough handoffs, or pinned with `stats.checkpointTokens` in Even Keel's config; the `/stats` page shows the number and where it comes from;
- **how many handoffs the task has had** — after the third the hook stays silent until the context reaches **300k**: on tasks handed over again and again most handoffs lose money.

Even Keel knows the context as of its last poll of the session, a few seconds back, so a nudge may come one tool call late. A session never waits for an answer longer than two seconds (five on `Stop`).

Even Keel takes it from there: it stops the session and starts a new one in the same worktree with a handoff prompt that points at the note (see "Handoffs" in the [main README](../../README.md)). Outside a chain the line is just the end of a turn — start a new session yourself and give it the note.

## The check before the merge

A third hook, on `PreToolUse` of Bash, guards the merge of a chain session. When a command runs `git … merge … <branch>` with the branch of the session's own worktree — the session bringing its task into `main` — the hook asks Even Keel for the project's check (`/api/sessions/<id>/check`, the `commands.check` of the project). Even Keel gives the commands only when no CI it counts will judge `main`: the project counts none, or one does not answer. The hook runs them in order in the worktree, through the system shell, 20 minutes each at most; the first that fails blocks the merge, and its command, exit code and the last 60 lines of output go back to the session to fix. A command without `merge`, a merge of another branch, `--abort`, a session Even Keel did not start, or Even Keel not answering within two seconds — the hook lets the command through.

## Messages from the chat

A message the user writes from Even Keel's chat window to a session in the middle of a turn waits in Even Keel's mailbox; the fourth hook, `mailbox.mjs`, takes it (`POST /api/sessions/<id>/mail` with the event) and hands it to the session without stopping it:

- on `PreToolUse` and `PostToolUse` of any tool — into the context (`additionalContext`);
- on `Stop` — the stop is blocked with the message as its reason, and the turn goes on;
- on `PreToolUse` of `AskUserQuestion` — the question is turned down with the message, and the session asks again only if it still needs to.

Each message comes inside `<even-keel-message id="N">…</even-keel-message>`, so the chat shows it as the user's message. The hook says nothing in a subagent (the message waits for the main thread), for a session Even Keel did not start, or when Even Keel does not answer within two seconds (five on `Stop`). Even Keel counts a session as listening only once its hook has asked: a session of an older version of the plugin is answered only between turns.

## Install

As a package of the project's set on Even Keel's `/tools` page: chain sessions of both agents get it from there (`docs/packages.md`). Installed into Claude Code by hand, it does nothing outside a chain.

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

Put them into the environment the sessions run with. Set the first nudge well below the size where the CLI compacts the context. A step that would land less than a late step before `CHECKPOINT_LATE_TOKENS` is skipped, so two nudges do not come one right after the other.

The hook remembers the last nudge per session in `claude-context-checkpoint/` under the system temp folder. After a compaction drops the context below the first threshold, the next nudge counts as the first again.
