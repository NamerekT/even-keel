# Page: the project wizard

Adding and removing a project (BTN-118): the wizard's steps, the check, Claude Code's trust, a project without git, the kept draft. Its frame is shared with the first run's setup (`docs/web/setup.md`, "The wizard frame"); the Repository card's field and the creation job are `docs/web/wizard-repository.md`.

## Where it opens

- The wizard is `/projects/add` (`web/src/pages/ProjectAdd.tsx`, pure logic in `projectWizard.ts`). The home page sends there by itself when the config has no projects and no `configError`; otherwise it opens by "+ Add project" next to the title. A first start without a config file starts with no projects, and the page opens the wizard.
- In the first run (no project yet) it stands under the setup's head and step line, as its last step "First project", with "← Back" to the stats (BTN-344); standalone, with its own head and no line.

## The cards

The steps (BTN-197) are Agent → Repository → Tracker → Project → Tasks' folders, all shown at once. Each is a settings `Section` card whose head leads with a `StepDot` (`stepChecks` in `projectWizard.ts` over `checkMarks` in `wizard.ts`): empty — not filled in, an accent ring — the first such step, green — its check passed, red — it failed, the reason under its field.

- **Agent**: a `Select` of the providers, the shared one first in force and labelled so; the project's `provider` is written only when another one is picked (`withNewProject`). Under it the same readiness as the setup's (`AgentReady`); its "Add an account" opens the add dialog over the wizard. The readiness does not hold the add.
- **Repository**: the one field and how it was read (`docs/web/wizard-repository.md`). Once found, its line says the main branch with a `[change]` link that opens the branch field (it opens by itself for a checkout with no current branch and for a branch the repository lacks, and stays open while that branch is retyped). A blank branch is filled from the checkout's current one.
- **Tracker** (`web/src/pages/WizardTracker.tsx` over the shared `TrackerFields.tsx`, `docs/web/project-settings.md`, "The tracker block"): a `Select` of the tracker profiles of Settings → Trackers and CI, each with its kind's icon, and "Add profile" as its last option, which opens `ProfileDialog` and picks the saved profile.
  - First in it "Built-in (no account)" (BTN-769, `switchBuiltin`): no profile and no place, only the project's own key. It is picked at the start when there is no tracker profile (`firstFields`); a single tracker profile is picked at the start otherwise.
  - Under it the profile's state (signed in as whom, refused), then the fields of the kind's shape (`shapeOf`: `key` — Huly's project identifier, `place` — GitHub's `owner/name` with a free task prefix, `within` — Linear's team key and an optional project).
  - The fields suggest the tracker's projects (`profiles/projects` with the typed text, 300 ms after the last keystroke), and an exact match fills the key, the value and the name (`pickProject`). For `place` the tracker's value comes from the repository's remotes (`repo.suggested`: the first remote the adapter's optional `projectOfRemote` recognises — GitHub, a github.com remote).
  - The tracker's answer, the check's open tasks included, is the strip under the tracker project, its room kept while empty.
- **Project**: the name always, the key (Linear's team key, GitHub's task prefix) where the tracker does not give it. The key and the name are suggested from the repository's name (`keyOfFolder`, `suggestOfRepo`).
- **Tasks' folders**: a `Segmented` "Own folder per task | Permanent folders" with a line saying what the pick means and, for permanent ones, their count.

### Typed fields and suggestions

- A field the user typed is not overwritten by a suggestion (`WizardFields.typed`, `typedIn`).
- Switching the profile to another kind clears the suggestions of the last kind and its place, even a typed one: a GitHub repository means nothing to Linear (`switchProfile`, EKR-147).
- Switching the profile must not move the fields below: the empty `Select` keeps a line's height, a field head is as tall without its "?" as with it, and the folder's lines stay through a check of other fields.

### "What will be created" and the foot

- Under the cards `ProjectSummary.tsx` (a `Card` with a `FactList`) shows, live, the name and key, the tracker and its place (`trackerPlace`), the main branch, the folder, a task and its branch (`taskExample`: `KEY-12 → key-12/task`) and the folders.
- The foot: what the add still misses (`missingOf`, the first reason in the order of the steps, naming its card) with "Check again", and "Add project".

## The check

600 ms after the last keystroke, and on "Check again", the page sends the draft (`ProjectDraft`: repo, branch, key, name, tracker, tracker project, profile — `null` for the kind's default profile, slot count — 0 is a worktree per task, milestones, provider — `null` for the shared one) to `POST /api/project/check` (`checkDraft` in `src/projects/check.ts`). It checks that:

- the folder is a git repository and not another project's, and the branch exists (`docs/web/wizard-repository.md`);
- the entry passes `parseConfig` as the project would be added;
- the tracker answers `chainTasks` for the tracker project (its open tasks are counted; missing variables are named);
- the folder's Claude Code trust ("Claude Code's trust" below).

### What each card waits for

BTN-737: each card changes only with what it depends on.

- The folder's lines hold while the folder and the branch do (`repoCheck`).
- The tracker's answer holds while its `trackerBasis` (`projectWizard.ts`) does — the tracker, the profile, the tracker project as the adapter reads it (Linear: the team from the value or else the key) and the milestones; the key counts only for the `key` shape, where it is the tracker project. While it holds, the page sends the next check with `askTracker: false`, `checkDraft` gets `{ tracker: false }` and does not reach the tracker, and the page keeps the answer it has, its dot and its strip included. So the name, a free prefix, the folder, the branch, the agent and the slots never re-ask the tracker. "Check again" drops the held answer and asks it anew; a return to the page does not.
- The Project card still waits for the fresh check: its entry depends on the key and the name.

### Where a refusal shows

- Entry refusals are routed by code (`entryField` in `projectWizard.ts`), shared by the field messages and step dots. Only `wizard.keyShape` and `wizard.keyTaken` belong to the key (Tracker for the `key` shape, Project otherwise); `wizard.trackerPlace` belongs under the tracker project's field, and `wizard.trackerShared` under milestones.
- Blank required keys and tracker projects remain neutral: the footer's `missingOf` names what is missing.

### A shared tracker project

A tracker project another project reads is refused as `wizard.trackerShared` until the two split it by milestone (BTN-306). The refusal opens "Only tasks in milestones" under the Project step (it stays open while the milestones are typed); the draft's `milestones` become the new entry's `chain.requiredMilestones`, and `yieldedMilestones` (`src/config-form.ts`) takes them out of each other project's required ones or, when it requires none, adds them to its excluded ones. `withNewProject` writes that into their entries, and the check names those projects (`ProjectCheck.yields`) in a line under the field.

## Claude Code's trust

The trust check runs for a project on any agent, since a task's run can give it to Claude (BTN-429, BTN-983): the folder is trusted in the global `.claude.json` or in that of the shared Claude account's folder, the only one `claude` started with its `CLAUDE_CONFIG_DIR` writes the dialog to (`isTrusted`, BTN-300; the answer still carries the service machine's platform and user for older pages).

- The wizard only shows it: the Repository card says `wizard.trusted` when trusted and `trustTexts().pending` otherwise (`WizardRepo.tsx`). There is no trust switch, warning or command block in the wizard or the project's Sessions tab, and trust does not hold the add.
- Even Keel marks the project's checkout as trusted in Claude Code before each background launch or resume, using the selected account (`docs/sessions/agents.md`, "Claude folder trust (EKR-59)").
- A chain paused on `claude.untrusted` or `claude.trustWriteFailed` offers Check again and resume; retry saves trust again, after any damaged or unwritable account configuration is fixed. The trust commands of the `?host=`/`?platform=` fakes belong to that pause (`docs/web/fake-states.md`).

## Adding and removing

- "Add" is open once the repository, the entry and the tracker pass (`readyToAdd`). It sends `project/add`, which starts the creation job (`docs/web/wizard-repository.md`, "The creation job"), and the job's window opens the project once it is made.
- `project/add` rechecks the repository through the same `checkRepo` as `project/check` before writing anything (`src/projects/add.ts`). A repository refusal returns its notice and leaves the config and profile links unchanged; a folder inside a repository is stored as the repository root. Config validation still checks the key and tracker fields; adding does not repeat the tracker's network check.
- Removal is `ProjectRemove.tsx` at the bottom of the project settings' Repository tab: a confirm, then `project/remove`. `removalBlock` (`src/projects/removal.ts`) refuses while the project's chain runs or waits in the queue, a live session was launched for its tasks or works in its folders, a task holds a place (`held`) or cleanup leftovers remain, and the notice lists each reason.

## A project without git

BTN-883, `docs/chain/worktrees.md`.

- The Repository step starts with a `Segmented` "In a git repository / Without git" (`WizardFields.git`). It starts on `defaultGit`, the setup's answer, and before one on "Without git" when git does not start. Git that does not start closes "In a git repository" with the reason and a link to the setup's Git step.
- Without git the step is titled "Folder", its field may be blank or name a folder that does not exist, and `checkRepo` asks git nothing: a blank folder passes with `repo.root` = the `projects` folder Even Keel will make the project's own in (the id is not known before the add, and `trusted` is `null`); a typed one is refused only when it is another project's (`wizard.folderTaken`).
- Tasks' folders is then one line with no choice, and the summary shows the folder and "One folder for all tasks".
- `git.missing` and `git.noIdentity` come only from git calls, which a project without git never makes: with No and no git project nothing on the page asks for git.
- In the project's settings the Repository tab is `PlainRepoTab` and "Check and CI" one line.

## The kept draft

- The wizard's fields live in the module (`kept` in `ProjectAdd.tsx`, BTN-310) until a project is added, so leaving the page within the tab loses nothing typed; a browser reload clears it.
- The kept draft contains only changes made through its controls (BTN-1024, `projectWizardDraft.ts`). Each visit overlays them on `firstFields` from the current state, so untouched git and tracker-profile defaults follow the setup again. A manual profile choice keeps both its id and tracker kind together, including Built-in. Repository suggestions are recomputed rather than saved as manual edits.
- Failed checks or adds retain the draft; only a successful add clears it.
