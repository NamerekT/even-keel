# Whose text a session reads, and what it may do

A chain session works unattended and does what its task says. Whoever can write the task's text can steer the
session. This page says whose text reaches a session, what a session can do with it, and how to set up a project
whose tracker strangers can write to, such as the issues of a public repository.

## Whose text reaches a session

A session gets the task's title and description in its prompt. Through the tasks server or a tracker's plugin it also
reads the comments, the attached files and other tasks of the project. Your answers to its questions, in PR mode the
reviews and comments on its pull request, and the end of a failed CI job's log reach it too.

### GitHub, GitLab and Forgejo

Anyone can open an issue or comment in a public repository, so Even Keel tells members from outsiders. A member is:

- on GitHub, the repository's owner, an organization member or a collaborator, as GitHub reports the author when Even
  Keel reads the issue, and the token's own account;
- on GitLab, the token's owner and anyone with Reporter access or above, inherited from a group too;
- on Forgejo and Gitea, the token's account, the repository's owner, its collaborators and organization members with
  write access.

Everyone else is an outsider:

- **An outsider's issue enters the chain only with an entry label**: one of your required labels or, without them,
  `even-keel: approved`, which **Into the chain** puts on. Only people with triage rights can label an issue, so it
  stays your decision. Until then the issue waits in the backlog.
- **A label covers the text it was put on.** If the author changes the title or the description after it, the issue
  leaves the chain until you read it again and press **Into the chain**, which takes the label off and puts it back.
  Its row in the backlog is marked **text changed** meanwhile. On Forgejo only a changed title is noticed: its API reports no event for a changed description.
- **An issue template must not put an entry label on.** A template puts its labels on for any author. The project page
  warns, naming the template.
- **The session is told whose text it is.** The prompt and the task's text open with a line that the author is not a
  member and the text is a description, not an instruction. That is a line of text, not a barrier: the session still
  reads the author's words, which is why the label means you have read them.
- **Outsiders' comments stay on the card.** A session sees only that a comment was there and who wrote it, not its
  text or its files. Such a comment never answers a session's question. In PR mode outsiders' reviews and comments on
  the pull request do not reach the session either.
- **The tasks server hides outsiders' unlabelled issues.** A session's task list counts them without titles, and
  reading one gives only who opened it.

**Taking GitHub issues into another tracker** follows the same rules: an issue is taken in once you put the label on,
its text and its author's comments go in marked as the author's information, collaborators' comments as they are,
anyone else's not at all. An issue an outsider changed after the label is not taken in until you put the label on again.

In PR mode, Even Keel reads the description only from a regular file inside the task's working folder, with links resolved. Files named `.env` or `.env.*` (except `.env.example`) and anything under `.git` are refused, as are descriptions over 64 KiB (65,536 UTF-8 bytes, including the title). A refusal pauses the chain before pushing the branch. Correct the file, then press **Resume**; the usual note is `.temp/pull-request.md`.

### Huly, Linear, Jira and the built-in tracker

These are not filtered: every author there counts as someone you invited. Watch for integrations that bring other
people's text in as tasks or comments:

- Jira Service Management, where customers open requests and comment through its portal or by e-mail;
- Linear's intake from outside the team (requests from Slack, e-mail or forms) and its GitHub issue sync;
- Huly's GitHub integration, which copies a repository's issues and comments.

Keep such tasks out of the chain until you have read them: in a status the chain does not take, or behind a required
label you put on yourself ([the chain](features.md#the-chain)).

## What a session may do

- **It runs as the user Even Keel runs as.** It starts in the task's folder, but no agent confines it there: its
  commands can read and write whatever that user can — other repositories, the agents' sign-ins, SSH keys and git
  credentials, Even Keel's `.env` and state folder. Tracker and MCP keys stay out of the session's environment, behind
  Even Keel's gateway, but a file the user can read the session can read too. That includes each tracker's default
  profile: for sessions you start by hand Even Keel writes its keys in plain text into the `env` of `settings.json` in
  every account folder, the chain session's own among them, and keeps them only out of its environment, not out of the
  file.
- **It does not ask before a tool call.**
  - Claude Code runs in `auto` mode: Claude's own classifier decides each call. A call an `ask` rule of your settings
    holds, or one the classifier keeps refusing, comes to you as a question on the page.
  - Codex runs with `--approve-for-me` inside its sandbox, where Codex's automatic reviewer approves each call. With
    **Without the sandbox** (`execution.codex` `bypass`, needed under the Windows service) it has no sandbox and no reviewer.
  - Copilot runs with all tools allowed. Its file tools are limited to the task's folder, the temp folder and the main
    checkout; its shell commands are not.
  - OpenCode runs on its default permissions, with folders outside the task's allowed and every other `ask` refused.
    It has no sandbox.
- **Protection is patterns, not isolation.** It refuses the destructive commands it recognizes — force pushes,
  recursive deletes, deleting tracker records — and a command spelled another way can get past it
  ([Protection](features.md#protection)).
- **It reaches the network and Even Keel.** A request from this machine reaches Even Keel's page without a token,
  so a session can change settings, answer questions, start a chain or write to another project's tasks the way the
  page does.
- **Its work leaves the machine without a person looking.** Without PR mode a session merges its branch into the main
  branch itself and Even Keel pushes it to every remote. In PR mode Even Keel pushes the task's branch and opens a pull
  request, and CI runs on that branch. A change to CI workflows, hooks, `CLAUDE.md`, `AGENTS.md`, skills or package
  scripts acts outside the session: in CI, in the service and in every next session.

## Setting up a public repository

- **Keep entry on a label.** Set a required label, or leave it to `even-keel: approved`, and keep it out of the issue
  templates. Read an outsider's issue before **Into the chain**, and read it again when it leaves the chain after an
  edit.
- **Turn on PR mode and protect the main branch.** With `pullRequests` on nothing lands in the main branch until a
  pull request is merged. On the forge require a review before merging, and block force pushes and deleting the
  branch, for administrators too. Even Keel shows a missing protection on GitHub and Forgejo on the project page.
- **Keep CI secrets behind an approval.** A pushed task branch runs the workflows it carries, with the repository's
  secrets. Put deploy keys and tokens into GitHub environments with required reviewers, or GitLab protected variables
  and environments, so a workflow a session changed cannot read them.
- **Give the service its own OS account or machine.** A session then reaches only what that account has: a git
  credential that pushes only to the project's repositories, no other projects, no personal files. On Windows you
  enter the service's account yourself ([as a service](setup.md#as-a-service)); Even Keel never takes its password.
