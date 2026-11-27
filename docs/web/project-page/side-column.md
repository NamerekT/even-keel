# The project page: the side column, the boat and the meme

What the project page's side column holds while no panel is open: `IdlePanel` — an ASCII sailboat (`web/src/ui/voyage.ts`), a meme and a hint.

## The side column

- From 1200 px the project page always keeps the side column, so the chain does not change width when a panel opens; with no panel open it holds `IdlePanel`. Below 1200 px nothing is reserved and `IdlePanel` is not mounted at all (`useWide`), so its loops do not run unseen; in a hidden tab the boat's interval stops (`useVisible`), the meme's `requestAnimationFrame` is paused by the browser itself.
- Arriving at a project page with an empty hash opens the session panel of the chain's current task (`focusOnEntry` in `web/src/ui/focus.ts`): the hash is set with `replace`, so "back" still leaves the page, and only once per arrival — a mount or another project key — so the cross keeps the panel closed. The boat is left for a project without a current session. Up to 760 px, where the panel covers the whole window, nothing opens by itself.

## The boat

- The picture is set in 7px type and is as wide as the panel: `useColumns` in `IdlePanel` measures the panel on every resize and passes the column count to `voyageFrame`, so the sea and the sky stretch while the boat keeps its size.
- The boat rides two endless trains of waves with troughs below the calm level; the water's height inside a row is drawn with `'`, `-`, `.` and `_`, so the slopes are smooth instead of row-high steps. The hull is shorter than half the main wave, and under it the water is drawn up to its bottom, so the boat never hangs over a trough between two crests.
- The hull never tilts — a hull breaks into steps in ASCII; only the rig leans with the waves and the sway, by a third of their slope, and it is sheared rather than turned, so the boom keeps its row.

## The meme (`web/src/ui/memes.ts`)

### What is drawn

- `momentsOf` reads the page's situation — no open tasks, empty backlog, chain stopped, running, unattended or waiting out a limit, a task on its 3rd session, a checkpoint handoff, over $1000 in the strip's 30 days. A quarter of the draws take one of these moments' lines (`t.project.idle.moments`): a moment holds as long as the page stands still, so a bigger share made it a refrain.
- The rest take a general line (`t.project.idle.memes`); `drive`, the one line that switches the boat to the old picture crawling on wheels over a hill as over land; a play; or a chat.
- `pickMeme` never draws a line equal to the last.

### A line

Typed in parts like the home page's (1.5 s between parts) and erased at the same pace before the next one. A general line and a moment's line go 7 s after they are typed; the drive stays until the set of moments changes, but no less than those 7 s (the moments change as the page loads, too). The line is as wide as the picture and starts at its left edge, so lines of different length do not shift. With reduced motion the line is shown whole and only the event-driven ones change.

### Plays (`PLAYS`, `t.project.idle.plays`, BTN-1171)

- A story in acts that pile up like a chat's lines, so the viewer sees one story go on rather than a new meme: all the acts are laid out from the start, each is typed under the earlier ones 1.5 s after the last is typed (`actEnd`), the earlier ones stay above in the muted colour, and 7 s after the last act the whole pile is selected and deleted at once (`selectionAt`, `CHAT_SELECT`). With reduced motion every act shows at once.
- `spoons` is plain nonsense and `slip` the tagline turned around by a slip of the boat's tongue; both go back to the draws after their last act.
- `picture` moves the voyage its own way (`playMotion`): on "Now I have the full picture" the sea and the boat stop as "Full." starts and the sky (clouds and gulls) once "Picture." is typed, two more acts try to fix it with everything still, and the last act runs the whole voyage backwards (ticks go below zero) and stays for good with the whole pile — no line is drawn after it until the panel is mounted again.

### Chats (`CHATS`, `t.project.idle.chats`)

- A dialogue in the look of Claude Code, only on this panel: the human's `>` lines appear whole and muted in mono, the agent's `●` lines are typed, 1.5 s apart (`chatAt`). The lines pile up, all laid out from the start so the panel keeps its height; chats are short enough to need no scrolling. 7 s after the last line the chat is not backspaced but selected, a line per 0.15 s from the bottom, held selected 0.7 s and deleted at once (`CHAT_SELECT`).
- **The `limits` chat** (BTN-1510) acts outside the panel: the agent "fixes" the limits and they really leave the header for 10 s.
  - `pickMeme` offers it only with a reset from `limitsFixReset`: the five-hour window of the account the header shows (`useHeaderFiveHour` in `web/src/layout/limitsFix.ts`, picked as `Header` picks it; none in "All machines") spent from 90 %, not `limitsOutdated`, its reset still ahead, and no reduced motion, where the chat shows whole and has nothing to take away.
  - Its lines keep their own beats (`limitsFixStarts`): the third starts 2 s after `Update(Limits.tsx)` is typed, and with it the header's limit segments hide (`LimitSegment`, `.limit--gone`, `visibility` so the header keeps its place; the account name, the button, the accounts panel and the limit banners stay); the human asks 8 s later and at 10 s the limits come back with the CLI's English "You've hit your limit, resets 2pm" in both languages, the reset read from the window at the draw.
  - The panel sets the hiding on each frame (`setLimitsGone`) and clears it when unmounted, so a side panel, another project or page and a window under 1200 px bring the limits back at once, and a tab hidden longer than the rest of the 10 s finds them back on its first frame; a window that drops under 90 % mid-chat lets it finish. Nothing reaches the server or storage.
  - Fake: `/p/ABC?limits=full` (close the opened session panel first).
