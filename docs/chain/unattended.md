# Chain: unattended mode

## Unattended mode (`unattended`)

A switch on `/settings`, the Chain group — for when nobody is there to answer, at night say. Stored as Even Keel's setting row `unattended` (`docs/storage.md`; the command `chain/unattended` with `{ on }`); while it is on, the page shows `UnattendedBanner`.

- **The prompt.** `PROMPTS.unattended` (`src/chain/prompts.ts`) is appended to each new session's prompt — launch, handoff, "New session", fix and carry:
  - ask no questions and do everything the question does not hold up;
  - a question with a default option — take it, finish and merge, file the question as a task;
  - a task that cannot be finished without an answer — commit to its branch until `git status` is clean, do not merge, put the question with its options in a comment, add the question label, and as the last step move the task to Backlog (the post-commit hook moves the status forward, so after the commit and with a check).
  - A project without git gets `PROMPTS.plain.unattended` instead (`withUnattended` with `git = false`, chosen in `wirePlanFor` by `isPlain`; BTN-961). It differs in having no commit, branch, merge or hook: a finished task ends by its result and `TASK DONE`; one that cannot be finished leaves the folder's files as they are and ends its turn without `TASK DONE`, which would close it.
  - Chat replies (resume and SDK steering) and automatic resumes do not add the text; sessions started before the switch was turned on get it only with a new session or a handoff.
- **A task moved to Backlog** drops out of the chain like any task back in an inactive status: it is released, and the worktree or slot with its branch stays. Moved back to Todo once the user has answered, it gets a handoff that points at the answer (exception 9). A clean tree matters in "slot" mode: a dirty slot is not taken, and a couple of parked tasks with litter would stop the chain.

## The two quiet-session skips (`src/chain/quiet.ts`)

Both work only in unattended mode; neither touches the session.

- **`unanswered`.** The current task's session is not mid-turn (a question it waits on counts), has no limit, paid-usage wait, model refusal or checkpoint, and has been quiet 10 minutes — counted from the latest of its last response, the chain's taking of the task and the last `--resume` or handoff by a checkpoint or "New session" (`resumedAt`). The task is skipped as by "Skip" (`skip` in the log), so the night does not stand still when a session did ask or a hook sent it back. A merged task goes to Done within seconds and is never caught.
  - A carry session (`<KEY>-CARRY`) is let go the same way, as its "Skip" would ([`projects.md`](projects.md), "The carry session", BTN-693).
  - A fix session (`<KEY>-FIX`) is not: its "Skip" would let the chain launch tasks on a red main, so an idle fix holds the chain until the user answers or skips it.
- **`quietTooLong`.** The chain does not wait for a task in Done (`closing`) longer than 10 quiet minutes from the session's last response: the task goes to `released`, the released-task sweep cleans it up once its session is not mid-turn ([`cleanup.md`](cleanup.md), "Released tasks"), and the chain goes on.

A turn that ended on a background command (`shell`) is mid-turn for both: [`background.md`](background.md).
