# Projects

A project is a repository — or a folder without git — with a tracker to take tasks from and an agent to run them. The wizard that adds one checks each of these as you fill it in.

## The wizard

First the wizard asks **How tasks work**: **In a git repository** or **Without git**. It starts on the answer of the setup's [Git step](setup.md#the-git-step), and the choice is made once: a project without git can later only [turn git on](chain.md#turning-git-on). Without git the folder step is called **Folder**, its field may stay blank — Even Keel then makes a folder of its own — and all tasks work in that one folder ([A project without git](chain.md#a-project-without-git)).

Then you fill in:

- **the agent** of the project — the shared one unless you choose another. The wizard says whether it has a CLI and a signed-in account; **Add an account** opens a dialog over it;
- **the repository's folder or address** ([below](#the-folder-or-the-repositorys-address));
- **a tracker profile** — **Built-in (no account)**, one you have, or one you add right there — and **the project in that tracker**, which the wizard suggests from the tracker's list and, on GitHub and GitLab, from the repository's remote (on GitLab, a remote on the profile's server).

The wizard checks:

- **the repository and its main branch.** It suggests the checkout's current branch and offers the others; a branch the repository lacks is created when the project is added, and the checkout switches to the branch you name. A folder that is not a repository yet, or one with no commits, gets a button that runs `git init` and makes an empty first commit on that branch;
- **the project in the tracker** — it shows how many open tasks it sees;
- **Claude Code's trust in the folder.** It is needed even when the project runs on another agent, since a single task can be set to run on Claude Code on its card ([A task's own run](sessions.md#a-tasks-own-run));
- **where tasks run** — **Own folder per task** (a git worktree made for the task and removed after Done) or **Permanent folders**, the chain's *slots*: a few folders a task switches the branch in, so a heavy build is redone only for what changed ([Slots](chain.md#slots)).

All the steps are on one page. Each is marked once its check passes; when one fails, the reason is under its field and the step turns red. Empty required fields are named at the bottom of the form, and **What will be created** there sums the project up before **Add project**. When you add the project, Even Keel checks the repository again before saving it.

The wizard keeps what you changed yourself when you leave it and come back, and after a failed check or add; adding the project or reloading the browser page clears the draft. A Git or tracker choice you have not touched follows the setup's current answer.

## The folder or the repository's address

The repository need not be on the machine yet. A project in git has one field, **Folder or repository address**, and Even Keel works out from what you type what to do; a short line with an icon under the field says how it read it:

- **An address** — `https://…`, `ssh://…`, `git://…` or `git@host:owner/repo.git` — is a clone. Even Keel asks the remote right away, so a wrong address or a missing sign-in shows before you add anything. A private repository needs git on Even Keel's machine signed in to that server as the user Even Keel runs as (its credential helper or an SSH key). An SSH server that user has never connected to is refused until its host key is accepted once: the wizard shows the `ssh -T` command to run in that user's terminal. A main branch the remote lacks is created when the project is added.
- **The folder of a repository** — a clone already on the machine — is taken as it is; the line names its remote, or says it has none. A folder inside a repository is refused with a button that puts the repository's top folder into the field.
- **A folder without git** becomes a new repository: whatever it already holds goes into the first commit, except what its `.gitignore` files leave out, and the wizard says how many files and how much that is.
- **A path that is not there** — Even Keel makes the folder and a new repository in it; the line shows the full path, so a typo is visible.
- **Just a name**, such as `my-app` — a new folder with a repository in Even Keel's projects folder (`projects` in its data folder), numbered if the name is taken.

A path must be full: a relative one such as `./my-app` is refused, and so are a whole disk and the home folder.

A clone goes into the projects folder under a name it suggests from the address; type another name, or press **another folder…** for a full path anywhere. It needs an empty folder or one that is not there yet. If the projects folder already has a clone of the same remote and branch that no project uses, the wizard offers **Use it**.

A clone and a new repository need git's name and e-mail for commits: without them the wizard says so under the field, and **Set them** asks for both in a window over the wizard, keeping everything typed. If they turn out to be missing only while the project is being created, the same button appears under the failed step, and the step is retried once they are saved.

A project without git takes a folder the same way as a clone, with no address.

The folder accepts `~` for the home folder of the user Even Keel runs as and, on Windows, environment variables such as `%USERPROFILE%\Projects\example`, taken from Even Keel's own environment (a service running as another user uses that user's values). The saved folder is absolute, so a later change of a variable does not move the project.

## Adding the project

**Add project** opens a window with the steps: the folder, the clone with its progress (and its Git LFS files, if it has any) or the first commit, the project itself, Claude Code's trust and the project's packages.

A step that fails says why and offers **Retry**; when only the Git LFS files fail — say, one was never pushed to the server — the clone is kept and **Retry** downloads just those files.

**Cancel** removes only what Even Keel made — a folder it created, or what it put into an empty one — and only until the project is saved; after that the project stays and the window offers **Open the project**.

## What a project needs

Each project needs:

- in git, a repository with a main branch — `main` unless the project names another in **Main branch**; with a remote, Even Keel pushes it after every task; [without git](chain.md#a-project-without-git), just a folder;
- Claude Code's and Codex's trust in the folder, which Even Keel marks by itself ([Folder trust](agents.md#folder-trust)).

Every session is told in its prompt to commit and merge its branch into `main` when the task is done (in PR mode, to end the turn for a pull request instead); the project needs no rule file of its own for it.

A session gets the project's `CLAUDE.md`, `AGENTS.md` and skills as they are committed on the main branch: its worktree is checked out from there, so a file you have not committed yet does not reach it. Which of them each agent reads is in [the project's instructions and skills](sessions.md#the-projects-instructions-and-skills).

## The main branch

Tasks branch off the main branch and merge into it, and the CI and the check judge it. It is **Main branch** on the project's **Repository** tab, which offers the repository's branches, local and remote.

- **Changing it switches the checkout.** Saving another branch switches the main checkout to it: a branch the repository lacks is created from where the checkout stands, uncommitted changes going along; one only on a remote is taken from there. Nothing is saved when git refuses the switch or while the project has a task in work.
- **The other machines switch first.** The project's folders on the other machines of its pool switch the same way before the hub's; a machine that is offline or cannot switch (uncommitted changes in its way) stops the save with its name, and the machines already switched go back.
- **A checkout switched by hand** keeps the setting: the settings and the chain's card say so, with **Make … the main branch** and **Put the folder back on …**. A machine's folder switched by hand shows the same on the machine's page and in the project's **Machines** tab, and that machine takes none of the project's tasks until it is back.
- **Set by hand in the config**, a branch missing from the repository pauses the chain.

## Removing a project

A project is removed at the bottom of its **Settings** → **Repository**. The page refuses, and says why, while its chain runs or waits in the queue, a session works for it or in its folders, or a task's worktree or slot is still in use. Removal does not touch the repository, its worktrees or branches.
