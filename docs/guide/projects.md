# Projects

A project is a repository — or a folder without git — with a tracker to take tasks from and an agent to run them. The wizard that adds one checks each of these as you fill it in.

First the wizard asks **How tasks work**: **In a git repository** or **Without git**. It starts on the answer of the setup's [Git step](setup.md#the-git-step), and the choice is made once: a project without git can later only [turn git on](chain.md#turning-git-on). Without git the folder step is called **Folder**, its field may stay blank — Even Keel then makes a folder of its own — and where a task works is one folder for all tasks ([A project without git](chain.md#a-project-without-git)).

You pick the agent of the project (the shared one unless you choose another; the wizard says whether it has a CLI and a signed-in account, and **Add an account** opens a dialog over it), give it the repository's folder or address, pick a tracker profile (**Built-in (no account)**, one you have, or add one right there) and the project in that tracker, which it suggests from the tracker's list and, on GitHub and GitLab, from the repository's remote (on GitLab, a remote on the profile's server).

The wizard checks the repository and its main branch (it suggests the checkout's current branch and offers the others; a branch the repository lacks is created when the project is added, and the checkout switches to the branch you name; a folder that is not a repository yet, or one with no commits, gets a button that runs `git init` and makes an empty first commit on that branch), the project in the tracker (it shows how many open tasks it sees), Claude Code's trust in the folder (a task's own run can give it to Claude Code whatever the project's agent) and where tasks run — **Own folder per task** (a git worktree made for the task and removed after Done) or **Permanent folders** (a few folders a task switches the branch in).

All the steps are on one page, each marked once its check passes or with the reason under its field when it fails, and **What will be created** at the bottom sums the project up before **Add project**.

When you add the project, Even Keel checks the repository again before saving it.

The wizard shows a validation error under the field that needs correcting and marks its step in red. Empty required fields are named at the bottom of the form.

Leaving the project wizard and returning keeps the fields you changed yourself.

Untouched Git and tracker choices follow the current setup settings on each visit; a choice you made in the form takes precedence.

A failed check or add keeps your edits. Adding the project or reloading the browser page clears the draft.

### The folder or the repository's address

The repository need not be on the machine yet. A project in git has one field, **Folder or repository address**, and Even Keel works out from what you type what to do; a short line with an icon under the field says how it read it:

- **An address** — `https://…`, `ssh://…`, `git://…` or `git@host:owner/repo.git` — is a clone. Even Keel asks the remote right away, so a wrong address or a missing sign-in shows before you add anything. A private repository needs git on Even Keel's machine signed in to that server as the user Even Keel runs as (its credential helper or an SSH key). An SSH server that user has never connected to is refused until its host key is accepted once: the wizard shows the `ssh -T` command to run in that user's terminal. A main branch the remote lacks is created when the project is added.
- **The folder of a repository** — a clone already on the machine — is taken as it is; the line names its remote, or says it has none. A folder inside a repository is refused with a button that puts the repository's top folder into the field.
- **A folder without git** becomes a new repository: whatever it already holds goes into the first commit, except what its `.gitignore` files leave out, and the wizard says how many files and how much that is.
- **A path that is not there** — Even Keel makes the folder and a new repository in it; the line shows the full path, so a typo is visible.
- **Just a name**, such as `my-app` — a new folder with a repository in Even Keel's projects folder (`projects` in its data folder), numbered if the name is taken.

A path must be full: a relative one such as `./my-app` is refused, and so are a whole disk and the home folder.

A clone goes into the projects folder under a name it suggests from the address; type another name, or press **another folder…** for a full path anywhere.

A clone needs an empty folder or one that is not there yet.

If the projects folder already has a clone of the same remote and branch that no project uses, the wizard offers **Use it**.

A clone and a new repository need git's name and e-mail for commits: without them the wizard says so under the field, and **Set them** asks for both in a window over the wizard, keeping everything typed.

The same button stands under the error if the creation window gets there, and the failed step is retried once they are saved.

A project without git takes a folder the same way as a clone, with no address.

The folder accepts `~` for the home folder of the user Even Keel runs as.

On Windows it also accepts environment variables such as `%USERPROFILE%\Projects\example`, with any letter case.

They come from Even Keel's own environment: a service running as another user uses that user's values.

Unknown or empty variables stay as typed; values are expanded once. `$NAME` and PowerShell's `$env:NAME` are not expanded, and on Linux/macOS percent signs stay literal.

Checking, creating a repository and adding the project use the same expansion; the saved folder is absolute, so later environment changes do not move an existing project.

### Adding the project

**Add project** opens a window with the steps: the folder, the clone with its progress (and its Git LFS files, if it has any) or the first commit, the project itself, Claude Code's trust and the project's packages.

A step that fails says why and offers **Retry**; when only the Git LFS files fail — say, one was never pushed to the server — the clone is kept and **Retry** downloads just those files.

**Cancel** removes only what Even Keel made — a folder it created, or what it put into an empty one — and only until the project is saved; after that the project stays and the window offers **Open the project**.

### What a project needs

Each project needs:

- in git, a repository with a main branch — `main` unless the project names another in `branch`; with a remote, Even Keel pushes it after every task; [without git](chain.md#a-project-without-git), just a folder;
- for Claude Code in the background, Even Keel automatically marks the project's checkout as trusted in Claude Code before each background launch or resume, using the selected account. On Windows it writes the forward-slash path Claude reads, copying an older backslash entry when needed and preserving the original. Its task worktrees inherit that trust. This also enables repository hooks. The Agent SDK and other agents do not write Claude trust;
- for Codex, Even Keel likewise marks the project's folder as trusted in the account's `config.toml` before each turn, since Codex reads the folder's Protection rules only in a trusted project ([Folder trust](agents.md#folder-trust)).

The rule that a session commits and merges its branch into `main` when the task is done comes with the launch and handoff prompts, plugin or not (in PR mode the prompt says to end the turn for a pull request instead).

A session gets the project's `CLAUDE.md`, `AGENTS.md` and skills as they are committed on the main branch: its worktree is checked out from there, so a file you have not committed yet does not reach it. Which of them each agent reads is in [the project's instructions and skills](sessions.md#the-projects-instructions-and-skills).

### Removing a project

A project is removed at the bottom of its **Settings** → **Repository**; the page refuses while its chain runs or waits in the queue, a session works for it or in its folders, or a task still holds a place, and says which. Removal does not touch the repository, its worktrees or branches.
