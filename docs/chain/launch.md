# Chain: before a launch — pauses and waits

What holds a chain's next session before it starts: a pause, which a person or a fix lifts, and a wait, which passes by itself. The fresh tracker read of "Start" is in [entry](entry.md#start); the hold while a landing resolves in [worktrees](worktrees.md#the-hold-while-a-landing-resolves-btn-1582).

## Pauses that lift by themselves

- **The hooks.** Every launch, Start, Resume and `wake` asks the service's launch blocks (`LaunchPauses.block`, `src/chain/pauses.ts`): `blocked` (PR mode's readiness, [PR mode](pr-mode.md)), then `trackerBlock`, then `packagesPause`. A block pauses the chain with its code and cause; a running chain pauses before its next task, and the session at work is not touched.
- **Which task is checked** (BTN-521, `firstOf`). Start, Resume and `wake` check the agent and account of the task that goes first — the current one, else the next by the order — since its run may pick another account. With no such task known only the tracker profile and PR mode are checked, and the launch checks the rest.
- **Going in paused** (`admit`, BTN-316). Start and Resume do not refuse a block whose code is in `SELF_CLEARING` (`review.notReady`, `agent.copyMissing`, `machines.copyMissing`, `chain.noTrackerMcp`, `chain.packagesNotReady`): the chain goes in paused on it. Other blocks still refuse them.
- **Lifting** (`cleared`). The dispatcher lifts such a pause by itself once the hook lets the project through. It also lifts a pause on `chain.unknownModel` (BTN-679), which no launch block gives: it asks the async `modelBlock` hook (`ModelCatalog.refusal` for the first task's account and model) and goes on once the account has the model, as Resume would.
- **A tracker the sessions would not see** (BTN-656): with `brief` off and no package bringing the tracker's MCP server (`noTrackerMcp`, `docs/packages.md`), `trackerBlock` gives `chain.noTrackerMcp`. It lifts once a package brings the server or `brief` is on. The page puts "Turn on" with the package's name (or "Add the tracker's package", the add dialog) and "Turn the task description on" beside the reason (`web/src/pages/TrackerFixButtons.tsx`); no banner shows it.
- **Packages only the user can make ready** (not installed, failed to install, a key missing) pause on `chain.packagesNotReady` (`packagesPause`, BTN-657, `docs/packages.md`), except for a fix session of a red main.
- **A checked CLI copy missing** — `agent.copyMissing`, `machines.copyMissing` (`docs/sessions/cli-versions.md`).

## What a running chain waits for (BTN-657)

A running chain with no session at work names the first thing that holds its next launch, in the order `step` checks them:

- the closing of a Done task (`closing`);
- the CI of main (`ciWait`, [main-ci](main-ci.md));
- the first limits poll (`limitsWait`);
- a limit (`limitUntil`);
- the week of the task's model used up (`modelWeek`, BTN-816);
- the gateway or packages that pass by themselves (`packagesBlocked`; on a lane's machine elsewhere `packagesWait`, which names the machine, BTN-1524);
- a free slot (`slotWait`, [slot mode](worktrees.md#slot-mode-srcgitslotts)).

The chip of the card, the project page and the queue panel says "waiting ·" and the reason (the card only "waiting": its line is right under it), and the card and the page add a line per wait with a button where one ends it (`chainWaits` in `web/src/waits.ts`, `web/src/pages/ChainWaits.tsx`). A wait that never passes by itself is a pause with a reason, not a wait.
