# Page: the first run's setup

The first run's setup `/setup`: its steps, the frame it shares with the project wizard, and where it stopped. The project wizard is `docs/web/project-wizard.md`; its Repository step and the creation job `docs/web/wizard-repository.md`.

## First run

BTN-310. `/setup?step=<step>` (`web/src/pages/Setup.tsx`, the steps and their addresses in `setupSteps.ts`), where `/` sends the page while `firstRun` holds (`src/setup.ts`: `tally` is `null` and there is no project; with projects and no stats it sends to the stats step alone).

- Each step is written at once as the shared settings (`settings` with the form in force as `base`), never held in a draft.
- While `/setup` is open the header shows only the logo and the gear: no Stats link, chain, account or limits (`Header.tsx`).
- There is no mark of a setup done: the stats go last because choosing them is the end.

## The steps

### Language

`language` and `promptLanguage` as two rows, "Page" and "Session prompts", each an `English | Русский` pick. A page language picked sets both and the page turns at once; "Next" writes the language shown when `language` is still `null`.

### Phone access

`SetupPhone.tsx`, BTN-1638. The invitation of a new device from "Sign-in and devices", right in the setup, so the phone comes in without the owner key from `.env`.

- A lead, the three moves (scan, compare the digits, Let in) and "Invite the phone", which opens the same `InviteDialog` through `useInvitation` (`web/src/pages/useInvitation.tsx`, shared with `SignInSettings.tsx`); the step reads `auth/devices` only while the dialog is open.
- Done once a device is let in: `EvenKeelState.signInOn` (`AccessBook.signInOn`, BTN-1656), sent anew on every change of the invitations (`InviteDesk`'s `changed` also calls `stateChanged`, once more after the first "Let in" turned the sign-in on). Then a line says so, the button becomes "Invite another device" and the foot's "Next" appears.
- On a page opened by a loopback name (`loopbackName`) the button is there too, and the dialog links to an outside address the hub has seen or asks for one (BTN-1661, `docs/web/sign-in.md`, "Invitations").
- No key is made: an invitation turns the sign-in on by itself.

### Git

`SetupGit.tsx`, BTN-731, BTN-886.

- First "Use git?", two cards, Yes and No, the pick written at once as `defaultGit` (`gitChoice` in `setupSteps.ts`: the setting once given, before that Yes where git starts and nothing where it does not; "Next" writes the Yes shown when `defaultGit` is still `null`). No goes on to the next step at once and shows nothing of git, the dot's summary "Without git".
- Yes adds "Git": the installed version (`EvenKeelState.git`, `GitSetupView` from `gitSetup` in `src/git/setup.ts`, read at the service's start and on `git/check`), or, when `git --version` does not start (`GitResult.missing`: an ENOENT of `execFile` or, on macOS only, a nonzero exit containing `xcrun: error: invalid active developer path`), the install command and the download page:
  - The command is of the package manager the service finds on its own `PATH` without starting it (`GitSetupView.install` from `gitInstallCommand` and `onPath`, EKR-54): winget on Windows; always `xcode-select --install` on macOS, regardless of Homebrew; the first of apt-get, dnf, pacman, zypper, apk on Linux; none found — no command.
  - The git-scm.com download page of the platform is always under it (`gitDownload`), alone when there is no command, and "Check again" beside the first of the two.
  - On macOS a note says that only Command Line Tools are installed, Xcode from the App Store is not needed, and full Xcode with an unaccepted license needs `sudo xcodebuild -license accept`; that license failure remains an ordinary git error.
  - Even Keel never installs git itself.
- **A git installed while the service runs (Windows).** A git that does not start makes the read, at the start and on "Check again", add to node's `PATH` the folders the registry's machine and user `Path` have and it lacks (`refreshWindowsPath` in `src/windows-path.ts`, BTN-1723: `reg query`, `%VAR%`s of a `REG_EXPAND_SZ` expanded, the service's own entries kept in front, compared by `pathKey`) and asks `git --version` again, so a git from its installer is seen without a restart. Only when that too finds none, a line says what makes Even Keel see it (`GitSetupView.restart`, `windowsStart` in `src/updates/control.ts` from the parent process): the tray's Restart or a restart of the Windows service by its name, after which node starts with `PATH` read anew (EKR-57), or, for node started in a terminal, a start from a new terminal, since the old one keeps its `PATH`. Linux and macOS have no such line: their package managers install into a folder already on the service's `PATH`.
- "Name and e-mail for commits", shown once git starts: two fields filled with `user.name`/`user.email` as git reads them in the service's home folder, and "Save", open once both are filled and one changed, which sends `git/identity` (`git config --global`, as the user the service runs as).
- "Next" waits for `gitStepReady`: No, or Yes with `gitReady` — a version, a name and an e-mail. The step gets "Skip for now" while it is held: nothing picked, or Yes with git not ready (`gitHeld` in `Setup.tsx`).

### Agent

`SetupAgent.tsx`, BTN-603. Three sections, each with a `StepDot`:

- "What runs the sessions": a card per provider with its icon (`AgentIcon`) and one line, "installed <version>" or "not installed" (`CliCopyView.installed`, `VersionWatcher.installedOf`), the card a pick.
- "<Agent> version": `CliSourceChoice` (`web/src/layout/CliSource.tsx`) — `Yours | Checked` radios for the chosen provider's `cli`, Checked through the consent dialog and `cli/download` with `CliProgress` under it, without the CLI the install `CommandBlock` and "Check again".
- "<Agent> account": "+ Add" in the heading's aside (opens the add dialog over the step, `useOpenAdd`, `docs/accounts/page.md`, "Accounts: the drawer, the page, adding, switching") and the provider's accounts as a table: a radio mark that writes `accounts.<provider>`, the name, and on the right "needs a sign-in" with "Sign in" (sends `account/renew`), "checking…" or Copilot's note. Without a CLI or a copy there is no "+ Add", only a note that the sign-in goes through the CLI; a copy that ends downloading with no account opens the add dialog by itself (BTN-542).
- "Next" waits for `agentReady` (`setupSteps.ts`): something to run on (`cliRunnable`: the CLI on Yours, the copy on Checked, even downloading) and an account.

### Tracker

`SetupTracker.tsx`. First the built-in tracker's card, with nothing to connect (BTN-769), then a card per tracker kind (Huly, GitHub, Linear): its profiles by the name after the kind's (`profileShortName`) with their state, "Edit" on a refused or unreachable one, and "Connect" or "Add another", which opens `ProfileDialog` fixed on that kind.

### Updates

`updates.check` on or off as cards. The service holds the check while `firstRun` holds (`UpdateWatcher.enabled` in `src/service.ts`), so it is asked, not on by default.

### Stats

`StatsStep` (`docs/stats.md`), whose choice ends the first run and opens the project wizard.

## The wizard frame

BTN-346, `WizardFrame` and `WizardFoot` in `web/src/pages/WizardFrame.tsx`, `wizard.css`; the pure part (`stepMarks`, `filledShare`) in `wizard.ts`. The setup and the project wizard both walk in it.

- One column in the middle of the page: its head ("Set up Even Keel" and that anything can be changed in Settings), then the steps as dots on a line, each a link. A done one is filled with a check and, under its label, what it holds (`summaryOf`, a `StepSummary` drawn by `Summary`, no fact glued with a `·`, BTN-1380); the current one a ring; one without its answer empty wherever it stands. The last dot, "First project", leads to the project wizard.
- The summaries: the page's language with the prompts' under it when they differ, "Sign-in on" for phone access, Git's version with the commit name and e-mail in its tip, the agent's icon before its account (the e-mail cut at `@` by `accountShortName`), the tracker's icon before the first tracker profile with "(+2)" for the rest and every profile in the tip, the update choice, the stats mode.
- Under the line the step is one card with its title and its foot: "← Back" at the left, at the right the primary button named after the next step ("Next: Tracker →").
- An optional step (`OPTIONAL_STEPS`: Phone access, Git, Tracker, Stats) has "Skip for now" instead when there is nothing to go on with — phone access before a device is let in, the tracker without a profile, the stats (to the project wizard; not offered once there is a project, whose `/` would send back to the stats).
- Enter presses the primary button unless the focus is on a control or a link or a dialog is open.
- Motion (a step sliding in, choice cards rising, `--motion-appear`) is off with reduced motion. On a narrow screen the dots lose their labels and the current step's name stands under the line.
- A dot is the shared `StepDot` (`DotMark`): the line's done/current/future, and the project wizard's card dots, which add passed (green with a check) and failed (red with "!").

## Where the setup stopped

BTN-1023. A step is done by its answer, not by its place, and one function says so for both the line's checks (`setupLine` → `WizardStep.done` → `stepMarks`) and the step to come back to (`stepAnswered` and `setupStop` in `setupSteps.ts`).

- Language — `language` set; Phone access — `signInOn` or a skip; Git — No, or Yes with `gitStepReady` (the Yes shown before a pick is no answer), or a skip; Agent — `agentReady` only, so a provider without an account has no check; Tracker — a profile or a skip; Updates — gone past, since `updates.check` is on by default; Stats — `tally` set or a skip.
- A skip and the update step are kept in the global setting `setupPassed` (`docs/settings.md`), written by "Skip for now" and by the update step's pick or "Next", so a skipped step is not offered again.

### "Set Even Keel up?"

- While `firstRun` holds and some step has no answer (`unfinishedStep` in `web/src/pages/SetupAsk.tsx`), every way into adding a project asks it first (`AddProjectLink`: Home's "+ Add project" and its empty state, the demo's band and end card "Connect your own"; `SetupGate` on `/projects/add` opened by its address). Yes goes to the first step without an answer; No closes the question and leaves the person where they were — on the wizard when they came by its address.
- The setup's own ways into the wizard (the line's last dot, the stats step's end) carry `FROM_SETUP` and are not asked.
- The welcome with no project at all does not ask either: its project card is itself named "Set up Even Keel and connect a project" and links to that step (`DemoWelcome`).
- Every step answered — the links go straight to the wizard.
