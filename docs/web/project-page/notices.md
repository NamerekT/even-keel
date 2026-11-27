# Project page: notices, the limit band, work left, the carry

What the project page says about trouble: the error bands, a session's limit, work no commit of main holds, and the carry of a release project. The words of these messages follow `docs/web/language.md`; their events in the log are in `docs/web/event-log.md`, "Page events".

## Error bands

`ProjectNotices` shows pause and ordering errors once per distinct notice (`projectErrors`, `sameNotice`), with settings and PR-mode fixes in the same band. The error reads in two lines (`SaidLines`, `web/src/ui/ProjectLinks.tsx`): what happened in bold, the causes and the one thing to do smaller under it. A failed chain-control command stays by its controls.

## A session's limit

- One `Band` (`LimitNotice.tsx`, `limitMessages.ts`) shows only the newest of the command refusal, the agent's report and the continuation plan: the agent's report is the last line of the activity feed anyway, and a refusal already names the reset. The refusal belongs to that session and goes away when it resumes.
- Its full-width `ButtonWithTip` opens Project settings → Sessions, where the provider's shared or own pool is chosen; changing the provider on the task's card ("Runs on") is the other way. The attached `?` button holds the account and recovery instructions in a press-only tip (the `useTip` toggle of `HelpTip`). Neither the band nor the event toast promises that the header's account switch changes a task on another provider.
- The account and provider in `chain.limitSpent` come from the task's run choice through `currentAccount` and `requireLimit`; older notices without these optional fields still render. `say` and `sayIds` give its reset in local time, nested notices included; the log keeps ISO.

## Work left in a folder (BTN-298)

Work no commit of main holds (`EvenKeelState.works`, `docs/chain.md`).

- **When it shows.** One rule decides it for the chain row, the backlog, the task card and the toasts (`shownWork`, `src/shown-work.ts`, read on the server for the event log): only once the task is out of the chain and no session of it is mid-turn — in the backlog or out of the chain, skipped, waiting on its pull request with uncommitted files (its commits are the pull request's), or closed with a cleanup warning in `leftovers`. A task the chain leads — mid-turn, between turns, asking — or one in Done whose cleanup is still under way has nothing: its files are its session's, and the server's read of them may catch a long turn before its commit.
- **The chip** (`WorkChip`, `web/src/ui/WorkChip.tsx`): a red outline, "uncommitted" with the files' count or "not merged" with the commits', the number a small `.count-badge` inside it; its `Tipped` tip has the words ("3 commits not in the main branch"), the path, the branch, a closed task's cleanup warnings and what to do. It stands on the chain row next to "question", in the session panel's status line, and on the backlog row after the milestone. The backlog tab's count plaque turns red when one of its tasks has some (`backlogWork`, the words in the tab's tip).
- **A closed task with the chip** keeps its row out of the archive (`archiveView` skips a block with `work` and does not count it), in its milestone, and carries the cleanup's warnings (`ChainBlock.leftovers`) into the chip's tip with a "Done" button on the row (`chain/dismiss`); the project head's cleanup warnings leave such a task out, so it is told of in one place. Once the work is committed and merged or the folder is deleted, the chip goes and the row goes to the archive; the warning, if not dismissed, comes back to the head.
- **The task card** has a red callout above the description with the same lines and the two ways out: answer and move the task back to Todo (exception 9 starts a new session with a handoff), or commit and merge by hand.

## The carry of a release project

The carry takes the release branch's commits into the main project's branch (`Forward` in `web/src/pages/ProjectNotices.tsx`, `ForwardView`, `docs/chain.md`); its band is on the release project's page.

- A held `forward.conflict` (BTN-369) is one red line — "1 commit of EKR conflicts with BTN in 2 files" — with "Resolve with the agent" (`forward/resolve`) at its right and "Details" folding the files and git's output (`.forward__more`) under it; "Carry now" is not offered for it.
- While the carry session is asked for or at work (`ForwardView.agent`) the band is a note in the working lamp's colour — "The agent resolves the conflict after the current task of BTN" or "… in the chain of BTN" — with "Open" to the session's row in the main project's chain (`/p/<id>#<KEY>-CARRY`).
- Any other hold, `forward.failed` among them, is the band with "Carry now".
- The carry's rows in the main project's chain are in `docs/chain/projects.md`, "The carry session"; `ChainList`, the session panel and the drag treat a carry like a fix (`isOwnName`), without the CI button.

The fake states of these bands (`?limit=`, `?forward=`, `?event=`) are in `docs/web/fake-states/setup-limits-accounts.md`.
