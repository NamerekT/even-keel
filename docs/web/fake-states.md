# Page: fake states

## Fake states (`npm run dev:fake`)

Chain drag previews and optimistic drops share `withOrder` in `web/src/ui/chainOrder.ts`: `withWaiting` places each locked external blocker before its first dependent in the proposed order, and the fix and carry rows hold to the neighbour `chainBlocks` put them by (BTN-808): a fix right above the task it interrupted, a carry asked for right after the interrupted task, else the current one; a fix that interrupted nothing and a running carry stay on top. `pinnedHead` keeps every current or interrupted task that stands above the dragged row — every running lane's, as one group (BTN-1611) — above it, so a drop lands no higher than right after the last of them; a task the chain passed over between running ones (pinned to a busy machine, BTN-1643) stays where it is and moves only under the running one above it, the server's `jumpsAhead` the same rule, and `reorderable` does not let any of them be picked up. The page lays that head out through `underWayFirst` (BTN-1617): the running fix and carry rows, then the running tasks, then the standing ones — an interrupted task, a current one on a paused lane (`halted`), a carry asked for — so the group "Under way" stays one and the interrupted task stands right under it; the server's order is not changed, a drop still lands below them all. `useChainDrag` measures every displayed row for `stackedTops`, including locked blockers and closed rows; `dragOffsets` moves the rows other than the dragged one only up or down, so a locked blocker keeps its indent in any place and a row taking its place keeps none (BTN-1767, `/p/ABC?chain=drag` with `--drag '[data-block="ABC-7"]' --hover '[data-block="ABC-10"]'`); drop targets and the submitted order still contain only chain tasks.

A drop the service refuses (BTN-1644) is a toast in the page's corner, `ChainRefusalToast` through the `chainRefusal` store: the dragged task "stays where it was", the refusal with its advice under it, and it goes by itself after `TOAST_MS`; the band under the list's last row is only the row buttons' errors. The rows go back when the drop's own glide is over (`afterDrop` of `useChainDrag`), so `useRowGlide` glides them home as any reorder; an answer inside the glide used to jump them back.

Layout work on a fake state, without a tracker or sessions. The fake history starts in November 2023 and has several projects and folders without a project.

CLI copy selectors resolve only known providers, including when a URL supplies an inherited object key such as `__proto__`. An unknown `copyAgent` leaves the state unchanged; an unknown `copyFailed` is ignored. A fake CLI command with an unknown agent fails with `Unknown agent`; completing a download for one does nothing. CLI copy lookup uses a `Map` so URL parameters cannot select or modify an object prototype.

The parameters are split by subject, a file each in `docs/web/fake-states/`: read this table, then the whole file of your subject. A new parameter goes into the file of its subject.

| File | What is in it |
| --- | --- |
| [`chain-states.md`](fake-states/chain-states.md) | Archive, outside view, copies, protection, `?chain=…`, `?backlog=…`, `?order=…`, `?landing=…`, `?changelog=…`, session and chat states |
| [`setup-limits-accounts.md`](fake-states/setup-limits-accounts.md) | The wizard, context, cache, limits, branches, config, CI, badge, packages, profiles, trackers, accounts |
| [`stats-cards-updates.md`](fake-states/stats-cards-updates.md) | Stats, tools, task cards, the built-in tracker, saves, backup, updates, the CLI check, git, chats, delay |

The default stats fixture includes separate Sol, Terra, Astra, Luna and DeepSeek comparison rows, sub-1% model shares, and 13 components (use `range=all` for "Show all"). `beforeModels`/`afterModels` select comparison families just as on the real page; no mark compares the page period on both sides. A long `account` value on `/stats` also exercises full wrapping names in "Limits by account".

`?limit=spend|spendUnknown` holds the current API session on a spending cap with or without a reset date; `/accounts?account=spend|spendUnknown` shows the corresponding account note (BTN-382).

The project notice states are on `/p/ABC?forward=warnings`: a carry conflict above five cleanup warnings. Use `warnings-agent`, `warnings-waiting` or `warnings-push` for a sixth, informational warning; `warnings-held` for a held carry; `warnings-long` for a long project label; `warning` for one cleanup warning; `empty` for none. These fixtures live in `web/src/live/fakeCarry.ts` and support the existing dismiss and resolve commands. Combine with `chain=later` for an ordering error above them.
