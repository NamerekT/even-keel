# Page: milestones and components in the project settings

The "Project tasks" tab of a project's main tracker window (Tracker tab → "Task sources" → the main tracker's "Configure", `docs/web/project-settings.md`): the milestone order of any tracker, and on the built-in tracker the milestone table and the Components tab. Routes and rules of the built-in lists are in `docs/trackers/builtin.md`.

## Milestone order

BTN-792, `MilestoneOrder.tsx`, the drag in `web/src/ui/useDragList.ts` (shared with the queue). A block under the milestone rules on the "Project tasks" tab, in either filter mode.

- It lists `ProjectOrder.milestones`, the live milestones the service sends with the chain: those of the chain's tasks, the project's own waiting blockers and the backlog, from the main tracker and the feeds (`TaskLists.milestones`, `milestoneSequence` in `src/chain/milestone-sequence.ts`).
- A milestone closed in the tracker stays in the list while open tasks carry it: `TaskMilestone` has no closed flag.
- The head says "auto" while the project has no `milestoneOrder` and offers "Back to automatic" once it has one; a milestone the saved list lacks carries "new".
- A drag or the arrow keys on a handle send the whole visible list at once (`project/milestone-order`, `{project, order}`; an empty order unsets the key), outside the window's draft and save bar, so every "new" mark clears; the row stays where it was dropped until the next state.
- The setting is read only in the project form, like `notices`.
- `order.later` and `order.against` carry the fix `milestoneOrder`: "Open the milestone order" opens the project's settings on the Tracker tab and the main tracker's window on this tab (the `sourceScope` tab in `settingsStore.ts`, read by `SourceDialog`'s `initialTab`).

## The built-in tracker's milestones

BTN-1287, `MilestoneTable.tsx`, `MilestoneDialogs.tsx`, `milestoneTable.css`, texts `t.milestones`. On a project of the built-in tracker the order block is this table instead: **every** milestone of the project, from `builtin/milestones`, not only the live ones.

### The table

- The head keeps "auto" / "Back to automatic", puts the order's explanation under a "?" and "+ New milestone" at its right.
- The open milestones (planned, active) come in the chain's order (`milestoneSequence` over their names and target dates and `milestoneOrder`) and are dragged as above. Each row is a button with columns — handle, place, name (with "new" while no task has it), "Open", "Target", "Status" and a pencil — never facts joined by "·". The target's tip gives the full date and "in N days".
- The closed ones (completed, canceled) are folded under "Closed milestones · N", not dragged, with "Tasks" and "Closed" for their columns; the closing date's tip names the target it had.
- On a phone the place, the pencil and the status word go (a dot alone, the canceled one a ring, the legend under a "?" in the column's head), and a tap opens the editor.

### The editor

- A dialog (a sheet from the bottom on a phone) with the name, the status as four equal buttons, the target date, the read-only closing date with its "?", the Markdown description and the facts "Open", "Closed", "Created".
- A new milestone cannot start completed or canceled and has neither facts nor deletion.
- Closing one with open tasks shows a warning band with their keys as tags, and its primary button reads "Close milestone".
- "Delete milestone" at the foot's left is off, with a tip, while the milestone has closed tasks; otherwise it asks where the open tasks go — "To another milestone" with a pick or "No milestone" — with the consequences (it leaves the milestone order and the chain rules) under a "?".
- Refusals are the dialog's band.

## Components

BTN-1288, `ComponentList.tsx`, `ComponentDialogs.tsx`, `componentList.css`, texts `t.components`. A tab after "Project tasks" in the window of a project on the built-in tracker, and only there.

- One card, its "?" saying what a component is and that the chain does not read it, "+ New component" at its head's right.
- The rows by name, without drag: the name (with the tag "new" while no task has it), the description's first line cut with "…", "Open" and "Total" ("—" for none) and a pencil; the whole row opens the editor. With none yet, a line says so. On a phone the description and the pencil go.
- The editor (a narrow dialog, a sheet on a phone) has the name and the Markdown description; an existing component also its "Open", "Closed" and "Created" facts and "Delete component" at the foot's left.
- Deleting asks with "Open" and "Closed" and, when it has tasks, "To another component" with a pick of the rest, or "No component"; the "?" says that closed tasks move too and the journal keeps the old name.
- Refusals (a taken name, a task the chain holds or a live session has) are the dialog's band.

## Rows that outlive their tab

BTN-1499, `useKeptRows` in `keptRows.ts`.

- The last answer of `builtin/components` and `builtin/milestones` per project is kept for the page's life: a tab mounts on it and asks again behind, an edit asks anew, and no answer started before it overwrites the newer one.
- The window asks for the components as it opens (`useEarlyComponents`, off the page's loader), and the project page's own read of the milestones (`useProjectMilestones`) fills the table's, so even the first switch to either finds its rows.
- When it does not, the window's glide follows: for `FOLLOW_MS` (2 s) after a switch, a change of the content glides too — mid-glide toward the new height from where the frame is, after it from the height it ended at — so "Reading the components…" grows to the table rather than cutting it off and jumping (`useHeightGlide`). While it glides the frame carries `data-gliding` and the body hides its scrollbar, the gutter kept (`addPackage.css`).
- In `dev:fake` `?delay=1000` makes the answers late enough to see it.
