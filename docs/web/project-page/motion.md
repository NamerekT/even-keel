# The project page: motion

How a change of the chain shows on screen: the beats of a change, the glide of a new order, the running group "Under way" and the flight of a task from the backlog. With reduced motion nothing moves, in all of them. The rows, the drag and the landing themselves are in `chain-and-backlog.md`.

## Motion of changes

`web/src/ui/motion.ts`, `web/src/pages/useChainMotion.ts`.

- **Data changes at once**; the motion only marks the change and plays only while the page is visible (`visibilityState`). With reduced motion no leaving copies are drawn either.
- **The last frame seen.** The page keeps the last frame the user saw per project and view — the chain, the parents, each machine's view (`ChainList`'s `machine`) — in memory, across page switches, and on return plays the net change since it: a task that came and went out of sight is not shown.
- **A switch of the view** is a filter, not a change of the chain (BTN-1577): the rows swap at once, a motion still playing in the view left ends with it (`Play.view`), and a lead card that mounts in the switch's render (`useSwitched`) shows its action field open and its line whole (`block__now--still`, `screen__line--still`, `still` of `ActionScreen`/`Typed`), taken at mount so a later line still types in.

### Beats

A **beat** is one step of a change's motion; beats go in turn, `--motion-step` (0.25 s, `STEP_MS`) apart (BTN-1613):

1. a finished task gets a check;
2. a running one let go takes its own frame back (the part beat, after the check is drawn, `STAMP_MS`);
3. a leaving one folds away in a step — a closed one up into the archive line, whose count bumps; the copy slides under the milestone line, which has the page's background;
4. new ones unfold;
5. the taken one gets its frame drawn around in a step and its lamp and cache ring (or ▶) light up. It grows into the lead tier only on its own beat (its size, background, title and action field wait for `--beat-take`) and types its action once the frame is drawn (`delay` of `ActionScreen`/`Typed`), so it does not look current before the previous task has closed.

A change that comes mid-motion plays alongside it (`stageOf`): running marks and leaving copies live to their own end, a block can carry marks of several motions, each mark with its own delay (`--beat-enter`, `--beat-finish`, `--beat-take`).

### Many changes at once

- More than five entries and exits at once — no beats: a line "While you were away: …" for 6 s that unfolds and folds back by height, so the list slides rather than jumps, and a soft glow on the new tasks. The line's counts are full, the tasks under a folded milestone included; the glow is only on the ones in sight.
- A key prefix gone from the chain while another came is a tracker switch (BTN-1200): its tasks were renamed, not gone and new, so they are in no count and the line, shown whatever the number, says the project moved and names the new keys and the old.

## The glide of a new order (BTN-1612)

`useRowGlide`, `reorderShifts` in `web/src/ui/reorder.ts`. A new order from the server — another tab's or the phone's drop, a rule, a failed drop sent back, a lane taking a row that joins no group — glides.

- After each render the rows on screen before and after whose place among themselves changed start where they stood and glide to `translate: none` in `--motion-fast` (0.15 s, `FAST_MS`), at once, with no beat. The rows out of the longest run that kept its order (the one that moved; of two that swap, the one going up) pass over the others.
- A row that came or went, or only moved because one did, keeps its own motion (enter, leave, the archive fold), so a done task's rows still rise by the fold of its copy.
- A move into the running group or out of it is the group's step instead (below), and so is every row it pushes in that render.
- Nothing glides while a card is dragged and for two settles after its drop (`held` of `useChainDrag`, whose drop has its own glide), or in the render that switches the view.

## The running group "Under way" (BTN-1613)

`web/src/ui/runningGroup.ts`, `web/src/pages/useRowGlide.ts`. Two running tasks and more — **lanes** of different machines, each a chain's own run of tasks on one machine — share one frame instead of a frame each.

- **Members.** The first unbroken run of rows a lane holds in the first section that has one, a question or an error included; a milestone's line between running rows parts them. A fix of main or a carry that runs is a member like any running task. A task that stands at the head — interrupted by the fix, or current on a paused lane (`halted`) — is not, and stands right under the frame with its own (`underWayFirst`, BTN-1617): when main goes red its row parts and the fix's joins, when the fix lands the fix parts for the archive and the task joins again once its session runs. The server's order is not changed by this layout; a drop still lands below them all. One running task keeps its own frame and no caption.
- **The frame** is `.chain__group`, a layer of the list placed over its rows' rects after each render and each frame of a glide, with the caption "Under way" as a pill on its top edge (BTN-1715). The frame paints the group's fill, its `::before` the line and the halo, and the layer's mask cuts a gap as wide as the caption (`--caption-width`, measured in `place`) out of the top edge, so the halo does not show over the pill's rounded ends (BTN-1624). Its edge takes the colour of the state that needs the user most — error (or a limit) over a question over work (`groupTone`, the lamps, not the tracker's question label). Its rows have no frame or fill of their own, a thin line between them (`block--grouped`, `block--group-first|inner`).
- **Joining.** A row comes in when a lane takes it, from below the locked rows too: on the take beat it glides to its place in a step (FLIP on `translate`, the rows it passes gliding with it) holding its own frame (`block--join`; the one row the group forms around, `block--merge`), and in the next step that frame melts into the line.
- **Parting.** A row its lane lets go (stop after the turn) takes its own frame back on the part beat (`block--part`) and glides to its place in the queue a step later, the frame held around it until then; a done one does the same after its check, then folds into the archive. When one row is left, the shared frame fades and its own comes back in the same step (`block--solo`). `moveDelay` and `regroups` (`motion.ts`) say when each row moves.
- **Back on a view** whose group changed out of it (BTN-1672: a machine's view switched to "All machines" after a lane took a task), the net change still marks its rows, but no row glides: the places on record are the view left's, and a row would fly in from where it stood there.

## The flight from the backlog

`web/src/pages/useArrival.ts`, `Flight.tsx`. The ghost of the landing is in `chain-and-backlog.md`.

- The ghost, in the size of the tier it will take, and a milestone it unfolds grow open and fold shut by height instead of appearing at once. A task that has entered the chain replaces its ghost at once; the 250 ms linger is only for a preview abandoned without a move.
- On the press the backlog row slides straight left out of the panel, fading, and folds (`.backlog__row--leaving`; the panel keeps a copy of it until then, should the chain take the task sooner). Once it has gone and the task is in the chain, a copy enters at the height of its block from behind the side column (`.flight` stands under `.project__side`) and slides straight left onto it, fading in, so it does not pop up out of nowhere when the column is closed or another card is opened meanwhile; then the block is marked for a moment.
- The flight's horizontal transform and opacity run through Web Animations, apart from the tracking shell (`.flight-track`), so React renders cannot stall the horizontal motion. The shell follows the destination during scrolling and layout changes, writing its geometry only when it changes. `Project` memoizes `chainBlocks` by snapshot and project, so local preview and arrival changes do not rebuild the archive.
- A locked blocker's "Into the chain" flies nothing: once the task is in the chain its own row slides from where it stood to its place over `--motion-step` and is marked.
- On a narrow screen (≤760 px) there is no flight: the narrow screen closes the panel instead. The browser check and motion frames are in `docs/verified/page.md` (BTN-515).

The fake states: `?chain=close|handover|reorder|group|fixGroup` in `docs/web/fake-states/chain-states.md`.
