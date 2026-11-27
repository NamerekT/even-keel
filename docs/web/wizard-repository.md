# Page: the wizard's repository and the creation job

The project wizard's Repository card (`docs/web/project-wizard.md`): the one field and how it is read, folder paths, git in the wizard, a clone, the folder; then the creation job that "Add project" starts and its window.

## Repository

### The one field

BTN-1048, BTN-1093. The Repository card (`web/src/pages/WizardRepo.tsx`, `RepoStep`) has, under the git mode, one field "Folder or repository address" (`WizardFields.target`, `ProjectDraft.target`); there is no source to pick. The service reads it (`readTarget` in `src/projects/target-read.ts`, the text's kind by the pure `targetKind` in `src/projects/target.ts`, tested for each platform on any machine) into the `source`, `remote`, `repo` and `folder` of the draft, and the check and "Create" go on from them (`sourcedDraft` in `src/projects/check.ts`, used by `settings.add`).

The answer's `repo.read` (`SourceRead`) is a block under the field (`ReadLine`): the head says how the text was read, a state beside it is a tag, and each fact under it is a captioned row (`ReadRow`: "Remote", "Folder", "Main branch" with `[change]`), never glued with a `·` (BTN-1380):

| Typed | Read as | The head | The rows |
| --- | --- | --- | --- |
| an address: `http(s)://`, `ssh://`, `git://`, scp `[user@]host:path` | `clone{host}` | "Clone from <host>"; an empty remote — the tag "empty repository" | the main branch; the folder line under the block |
| a repository's top | `existing{remote}` | "Existing repository"; none — the tag "no remote" | `origin` and its address (the user and password cut), the main branch |
| a folder without git | `here` | "New repository in this folder"; an empty one — the tag "empty" | the main branch; a filled one — the first commit's files and size under the block |
| a path not there | `make` | "No such folder — Even Keel makes it and a new repository in it" | the full path, the main branch |
| a bare name (no `/`, `\`, `~`, `:`, not `.`/`..`) | `name` | "New folder with a repository" | its full path in the projects folder, numbered past a taken one by the disk; the main branch |

### Refusals of the field

Refused by code, without git's output:

- blanks, text with spaces or control characters — `wizard.notTarget` with an example;
- a relative path (never taken from the service's working folder) — `wizard.fullPath`;
- a disk or the home folder — `wizard.rootFolder`;
- a subfolder of a repository — `wizard.insideRepo` with "Use the top", which types the top into the field;
- `%VAR%` on Windows that does not resolve — `wizard.noFolder`;
- a name the platform cannot make — `wizard.folderName`, `folderNameSlash`, `reservedName`, `nameEnd` (`nameRefusal`).

One letter before `:` is a drive on Windows only; elsewhere `foo:bar` is an address, as git reads it. A clone and a new repository need git's name and e-mail (`git.noIdentity` with its `NoticeFixButton`, the line still saying how the field was read); a repository without commits keeps "Make the first commit".

### Folder paths

BTN-744.

- `checkRepo` expands a leading `~` (`~/…`, on Windows also `~\…`) to the service user's home (`expandHome`, `src/projects/folder.ts`; `~user` and `$HOME` stay as typed), refuses a relative path (`wizard.relativePath`) and a folder that does not exist (`wizard.noFolder`, no git output, no button) before it asks git. The config gets git's absolute root.
- On Windows `expandFolder` also expands `%NAME%` from the service process's environment, case-insensitively, for checking, adding and the repository-creation button. Tracker-profile variables do not override these values. Expansion is a single pass after `~`; unknown or empty variables stay literal, and an unresolved leading variable gets `wizard.noFolder` rather than the relative-path notice.
- Linux/macOS treat percent signs literally; `$NAME` and `$env:NAME` are never expanded. Saved absolute roots are independent of later environment changes.

### Git in the wizard

BTN-731.

- A folder that is not a repository (`wizard.notRepo`) gets "Make it a repository" under its refusal, a repository with no commits (`wizard.noCommits`) "Make the first commit". Both send `git/init` with the folder and the branch field (blank — `DEFAULT_BRANCH`), then check the draft again.
- `initRepository` (`src/git/setup.ts`) refuses a missing folder (`wizard.noFolder`), a branch git would not take (`wizard.branchName`) and git without a name or e-mail (`git.noIdentity`) before touching anything; then `git init -b <branch>`, or for an unborn branch `git symbolic-ref HEAD refs/heads/<branch>`, and `git commit --allow-empty -m "Initial commit"`. A repository with commits is left as it is.
- When git does not start at all, `checkRepo` answers `git.missing` instead of `wizard.notRepo`, and so does any git call of the chain through `requireStarted` (`requireBranch`, the worktree steps): the chain pauses on that notice, whose fix is "Check again and resume".

### Name and e-mail

`git.noIdentity`'s fix is `{ to: 'identity' }` (BTN-1094): "Set them" opens `IdentityDialog` over the page, the setup Git step's two fields (`IdentityFields`, `useIdentityForm` in `SetupGit.tsx`) saved by the same `git/identity`.

- The wizard keeps everything typed and checks the field again after the save (`onFixed` of `NoticeFixButton`); the creation window sends `job/retry` from the failed step by itself; "Make the first commit" sends `git/init` again.
- The service reads git's name only at the start and on "Check again", so it may be gone while the view still shows it (BTN-1104): the dialog sends `git/check` on opening, and its Save takes both fields once filled, even the same values the view showed (`useIdentityForm(git, true)`). The setup Git step still saves only a change.
- The "Turn on git" dialog of a project keeps the step's `Identity` section in its body.

### A clone

The address in the one field (`ProjectDraft.remote` once read).

- **The check asks the remote first** (`git ls-remote --symref`, `sharedRemoteReader` in `src/git/remote-run.ts`, held for a minute per address). A text that is no address (`remoteShaped`: a URL, `[user@]host:path` or a full local path) is refused as `git.remoteShape` without asking git (BTN-1087).
- **A refusal** is `git.remoteShape|remoteDenied|remoteHostKey|remoteSshKey|remoteNotFound|remoteNetwork|remoteFailed` in one line under the field (`refusalParts` in `web/src/pages/remoteRefusal.ts`): the address cut to 48 characters, git's own words behind a `HelpTip`. `remoteFailure` (`src/git/clone-progress.ts`, BTN-1091) picks the code by git's English words (`remoteEnv` runs git with `LC_ALL=C`):
  - "Host key verification failed" — `remoteHostKey`, whose line names the server as `known_hosts` does (`host`, `[host]:port` off 22; BTN-1105) and whose `ssh -T [-p port] [user@]host` (`sshProbe`) is a `CommandBlock` under the line;
  - "Permission denied (publickey" — `remoteSshKey`;
  - no rights, or an HTTP(S) remote's "Repository not found"/404, which a private repository answers to a git not signed in — `remoteDenied`.
  - The fake's remotes with `private`, `hostkey` and `nokey` go through `remoteFailure` with git's real output.
- **An answer** is "Clone from <host>" with the main branch and `[change]`, which opens the branch field right under the one field, above the clone's folder line. A branch the remote lacks is no refusal: the default branch is cloned and the wanted one is made when the entry is written.
- **The remote's branches** (BTN-1096): the check's answer carries `remoteBranches` (`remoteOffer` in `src/projects/remote-branches.ts`) — the default first, marked so, then the typed one, then the rest, task branches `<slug>/task` left out. Past `REMOTE_OFFERED` (200) only those holding every typed word, with the remote's total, and the field lists at most 100 rows (`SuggestField`'s `limit`). The line under it says which branch is cloned, or that the default is cloned and the typed one made from it (`cloneLine` in `web/src/pages/branchLines.ts`), never a move of a checkout; a narrowed list adds how many branches the remote has. The fake's remote with `many` in its address has over a thousand branches.

### The folder

For a clone and "Without git"; a path or a name in the one field names the folder itself.

- Even Keel's projects folder (`projectsDir()`, the data folder's fixed `projects/`, no setting), then the name's field. Blank, the name is suggested (`checkPlace` in `src/projects/place.ts`: the remote's name, else the project's name or key; a taken one gets the branch, then `-2`…). "another folder…" turns it into a full path (`ProjectDraft.repo`).
- Under it the folder's state (`FolderPlace`): free — made on creation, empty, or filled. A clone refuses a filled folder (`wizard.folderFilled`); a new repository says what goes into its first commit (files and size, counted up to a ceiling; `measureFolder` asks `git ls-files --others --exclude-standard` against an empty temporary repository, so every `.gitignore`, `info/exclude` and `core.excludesFile` leaves out what `git add -A` would); a folder that is a repository already is `wizard.alreadyRepo`.
- A clone of the same remote and branch already in the projects folder, which no project has, is offered with "Use it", which types its path into the one field.
- The page sends `folder` only for a clone or "Without git" while no path is typed, and `checkDraft` routes a draft "Without git" to `checkPlace` only when it has `folder`.

## The creation job

"Add project" sends `project/add`, and `settings.add` (`src/service/hosting.ts`) builds the steps (`creationPlan`, `src/projects/creation.ts`) and starts them as a job (`stepJobs`, `src/jobs/runner.ts`; one live job of a kind; `EvenKeelState.jobs`). A refused draft starts no job: the check is repeated first.

The steps: the folder; the clone (`cloner`, `git clone --progress`, its stage, percent, size and speed parsed by `parseProgress`) with its LFS files shown once a clone starts filtering them, or the new repository's first commit (`git init -b <branch>`, `git add -A`, the commit); the project's entry; Claude Code's trust for a folder Even Keel made; the wait for the project's packages.

### The window

`JobWindow.tsx`, the add-package dialog's frame, not tied to the wizard: the job's `kind` names its steps, and adding a machine to a project takes it too (BTN-993).

- Each step's state and time (BTN-1099: `startedAt`/`endedAt` of the step, ticking each second while it runs, so a window with reduced motion still shows it lives; a finished step under a second shows none).
- A clone's progress bar and figures. A stage's last figures stay `STAGE_END_MS`, half a second, before the next stage's (BTN-1102): git ends a stage in one burst with the next one's first line — a large repository's "Compressing objects" goes to ~20% in seconds, then to 100% and on to "Receiving objects" within milliseconds — and a page built once per 200 ms would never show the end.
- The stages git gives no percent for ("connecting…" from `Cloning into`, "the server lists objects: N" from `remote: Enumerating objects: N`) under a bar with a running glint that reduced motion hides; the running step's ring is then a filled dot, not a still ring.
- The failure with its fix and "Retry" (`job/retry` runs the failed step again, the done ones are not repeated; a clone empties the folder it filled first, since `git clone` does not resume).
- "Cancel" (`job/cancel`): until the entry is written it aborts the step and removes only what the job made — the folder it created, the contents of an empty folder it filled, the `.git` it made in a filled one. Once the entry is written (`keptAfter`) the project stays: the note says so, and the button is "Open the project", which drops the job without undoing anything.
- Esc does not close the window. A finished job keeps its window until "Open the project" (`job/close`), which also removes the demo when asked and clears the kept fields.

### A failed step

A failed step is said as the remote field says a refusal (BTN-1100, `RefusalWords` in `web/src/pages/RefusalWords.tsx` over `refusalParts`): one line by the code, the tool's own words behind a `HelpTip`, its fix button, a command under it.

- **A broken clone** (`cloneFailure`, `src/git/clone-progress.ts`): a network line (`NETWORK`: besides an unreachable host, `RPC failed`, curl 18/28/56, `Connection was reset`, `early EOF`, `unexpected disconnect`, "the remote end hung up unexpectedly") after the server answered — any progress past `Cloning into` — is `git.cloneBroken` with the percent of objects received ("the connection broke off at 10% of the clone: … press Retry, the clone starts over"); before that it stays `git.remoteNetwork`. `runRemoteGit` keeps no progress line in git's words, `Cloning into` and `remote: Enumerating objects` among them.
- **A failed checkout** after the clone came is read before any remote reason (BTN-1106): its "not found" is never "no repository". `lfsFailure` takes the file from `fatal: <path>: smudge filter lfs failed`: a 404 or a remote's "missing object" is `git.lfsMissing` (the server lacks the file — never uploaded, as with `lfs.allowincompletepush`; its command block is `git lfs push --all <remote>` for a clone that has it), anything else `git.lfsFailed`; without LFS, "Clone succeeded, but checkout failed" is `git.checkoutFailed`.
- **The LFS step**: an LFS failure fails the LFS step, the clone stays done; the clone step begins it on such a code even when git reported no "Filtering content". A sub-step that fails is marked itself when it has a `run` of its own, which runs only as its Retry (`StepDef.hidden`). The LFS step's is `restorer`, `git -C <clone> restore --progress --source=HEAD --staged --worktree :/` — git's own advice plus `--staged`, since the failed checkout leaves the index empty — so Retry downloads the LFS files into the clone, never clones again.
