# Page: the home page, the basement and the 404

## The cards and their order

`web/src/pages/homeGroups.ts`.

- **Grouping.** A switch of four icons in the head (`GroupingSwitch`, kept in `localStorage` under `even-keel.home.grouping`, no groups until chosen): one plain grid (`none`), by repository, by tracker connection (`state.trackers`, titled by its `title`) or both — remote blocks, with tracker subheads inside a block only when it holds two trackers.
- **A remote group** is the projects whose checkouts share a remote, transitively. The service reads each checkout's remotes into `state.remotes` (`ProjectRemotes`, `src/projects/remotes.ts`) on a config change and every minute with the CI targets; `remoteRef` makes one id of every url of a repository — host and path in lower case, without credentials, port, `.git` or the remote's name, a local bare repository by its resolved path. The group is titled by the `owner/repo` most of its projects share (a local one by its folder). A project alone in its group, or without remotes, goes into a last block, "Other". With at least one group every block is a framed panel with its project count; otherwise the one block is the plain grid.
- **Inside a block** every project is a full card (`laidOut`): working first (the chain runs, is queued or paused, or a question is open — `zoneOf`), then the rest, then the quiet ones (`ghost`, `finished`, `shelved`), each in config order. The punchlines' turns (`emptyTurns`) follow this order.
- **The task on a card** is clamped to two lines, the whole title in a tip only when cut. When every open task is held — skipped, or behind a blocker the chain does not take — the card and the queue show the chain's first task marked "Skipped" or "Blocked" (`CardTask.held`), not "No open tasks".
- **Pressing a card.** A card selects no text: a press anywhere but its buttons and links opens the project. The cut task title stands above the stretched link for its tip, so it is itself a link to the project (`TaskTitle` in `ProjectCard.tsx`).

## Test projects

`homeTests`, `web/src/pages/homeTests.ts`.

- A flask button before the grouping icons (`TestsSwitch`), shown only while the projects in view include a test one (`testProject`), says whether their cards are laid out. It is off by default and then shows how many it hides ("N test projects hidden. Show them").
- The choice is Even Keel's setting `homeShowTests` (`state.showTests.home`, written by `view/tests`, `docs/settings.md`), not the browser's, so it outlives a reload and a restart.
- Hidden projects go before the grouping, so a group counts only the cards it shows and a group of test projects alone is not drawn. Every project in view hidden — an empty state with "Show test projects".
- The demo's project is a test one but is never hidden: it is the tour the page starts with.
- The memes, the questions line, the header's counts and the launch chart (which leaves test projects out anyway) read every project.

## An empty project

A project with no task to show says why through `emptyCard`: everything done, no tasks at all, or an empty chain with a backlog. These are quiet cards with the joke in their tip; open tasks that are only held back keep the plain "No open tasks" on a full card.

The same three kinds add a call to file tasks or ready them in the tracker (`emptyCall`): under the joke in the tip, at the top of the project page in place of "No tasks in the chain", and under the joke of a card (queued, paused or with a question). It has an "Open in <tracker>" button when the tracker gives the project's page (`trackerUrls.pages`, `TrackerSetup.projectUrl`). A project whose task feeds give pages too has one "Open in…" button whose list names each tracker, the project's first, every line a link in a new tab (`projectPages`; `TrackerPages`, `web/src/ui/TrackerPages.tsx`, the same on the card and the project page). Two pages of one tracker add their keys after the tracker's name.

## Memes

`web/src/ui/memes.ts`.

- **The line under the title** (`harborMemes`) is built from the user's own numbers — the busiest of the 14 days from 50 launches, a project with ¾ of at least 50 launches, 3+ open questions, the five-hour limit from 50 % — plus a line about Even Keel itself. One draw per visit picks among them; the numbers follow the state. Launches are counted by project id and the favourite is named by its label.
- **Typing.** The line is an array of parts typed by `Typed` (`web/src/ui/Typed.tsx`) with a 3 s hold between parts: once per mount, a changed number taken over without retyping, shown whole with reduced motion. Lines queue up like the chains do (`Typists`, `book`): as many type at once as `parallel`.
- **A card's line** stands still, so several cards do not type at once: a quote in the project's colour, the setup muted and the punchline in full ink.

## The basement and the 404

- `/stats` and `/tools` end with a basement (`web/src/layout/Basement.tsx`, put by a portal into `BasementSlot` below `main` so it spans the window; it comes once the page's data has answered and stays through filter changes): a wall, a floor, torn and worn caution tapes in a fixed layout, and a sign with the page's line (`t.basement`). With reduced motion the torn pieces do not sway.
- The 404 (an unknown route or a project not in the config) is the whole page as a basement: `tall` takes the rest of the window, `idle` turns the "work in progress" tape into bare stripes, and the sign carries `t.notFound` with the link up.
- The home and project pages get no basement: they are opened many times a day and have jokes of their own.
- While none of the chosen projects has answered, `/tools` shows the outline of its matrix (`web/src/tools/ToolsLoading.tsx`): the real section titles and project columns, a lamp per project (blue — reading, green — answered) and pulsing bars. It comes after 0.15 s, so a fast answer does not flash it.

## dev:fake

XYZ is the empty project, each project's page a made-up Huly address, ABC's feeds a GitHub and a Linear one. ABC and XYZ share `john/app` (`FAKE_REMOTES`), so the page shows one remote group; the fake has one tracker, so "by tracker" is one group of four. DEMO is the test project. `?launches=favorite` gives ABC most of the launches so the favourite line can come up.
