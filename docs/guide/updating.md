# Updating

From the page, by hand, trying the next version, plugins, stored state, going back. Docker installations update by [pulling the image](docker.md#updating).

The gear menu in the header ends with the installed version. Even Keel asks GitHub for its latest release at start and every 12 hours, if you allowed it on the first start's setup step (a request to `api.github.com` without a token; it names only the installed version). A newer release gets a mark next to the version and a notification in the corner of the page. Change that answer with **Check for new versions** in Settings → **Interface**.

## From the page

The mark and the notification open the update window: the installed version, the notes of every newer release, and **Update to &lt;version&gt;**. A release marked as a revert release (its notes have a **Reverted** section) takes back a part of an earlier release, and says which. The update:

1. waits, up to 5 minutes, until no chain is starting a session, handing over or closing a task — a restart in that moment would pause the chain; the page shows which projects it waits for. A chain only waiting for a limit to reset does not hold it;
2. installs the new version and builds it, then restarts the service;
3. waits up to 2 minutes for the service to answer with the new version and keep running.

If any step fails, including no answer, it puts back the version it started from and starts the service: you are back on the version you had. Either way the page reloads by itself and says how it went; **Details** shows the failed step and its output, and the whole log is `logs/update.log` (the outcome itself is in `logs/update.json`). Running sessions are not touched.

The button is there only when Even Keel runs as a service and its folder is:

- a global npm install, or
- a clean git checkout on the tag of the installed version; a clone that you update with `git pull` on the main branch is one.

Otherwise the window says why and you update by hand. A checkout that was on a branch stays on it (moved to the new tag), so a later `git pull` still works.

### Reverting

After an update the window and the gear menu also offer **Revert to &lt;previous version&gt;**, the same process in the other direction, as long as the update did not change the format of the stored state.

- When it did, the older version cannot read the state any more: the window says so, and going back is [the manual way](#going-back), losing what was written since. Better wait for a revert release: it takes the change back and keeps the new format.
- After a revert the newer release is offered again; nothing updates by itself.
- Once the version is changed by hand (below), the window no longer shows how the last update from the page went, nor offers to revert it.

## By hand

Running sessions are not stopped by any of this: they belong to the CLI's daemon, and the restarted Even Keel picks them up.

**Installed with npm, as a service.** This stops the service, installs the latest release into the same global folder and starts the service again:

```sh
even-keel update
```

`even-keel update 0.2.0` installs that version. On a release candidate (installed with `npx even-keel@next`), `even-keel update` takes whichever is newer: the latest release or the latest candidate. When nothing is newer, the command says so and leaves the service running. Unlike the button it does not wait for the chains, and a failed install leaves the version you had.

**Installed with npm, run in a terminal.** Stop Even Keel, run this, then start `even-keel` again:

```sh
npm install --global even-keel@latest
```

**A clone as a service.** Pull, then run its install again: it installs the dependencies, builds the page and restarts the service. On Windows:

```sh
git pull
node dist/src/cli.js install
```

On Linux and macOS:

```sh
git pull
service/install.sh
```

The Windows service without a sign-in takes `service\install.ps1` instead, from PowerShell 7 as administrator.

**A clone run from a terminal.** Stop Even Keel, then:

```sh
git pull
npm ci
npm run build
npm start
```

On Windows a running Even Keel holds files in `node_modules`: `npm ci` next to it fails with `EPERM` and leaves the folder half-removed. Stop Even Keel and run `npm ci` again.

## Trying the next version

With npm, the latest release candidate, when there is one:

```sh
npx even-keel@next
```

Or switch a clone to the `dev` branch and build it again (back to the release: the same with `git switch main`):

```sh
git switch dev
git pull
npm install
npm run build
npm start
```

`dev` is not a release: the page offers no updates on it, and the state it writes may be too new for the release to read, so test it in a separate clone.

## Plugins

The plugins come with the code. `agent-bridge`, the plugin through which chain sessions tell the page their stage and context, is built in and on in every project: there is nothing to add for it, and its hooks stay silent in sessions started by hand.

Chain sessions run the version of a package installed in **Settings → Packages**:

- A package's row shows the newer version its marketplace has, with **Update**; when it knows of none, its details have **Check**. For a git URL marketplace both fetch the marketplace first.
- **Check all** above the catalog fetches the plugins' marketplaces again and only shows the newer versions.
- **Update all** then presses every row's **Install** and **Update** in turn. The button shows which package of how many it is on, and leaving the section does not stop it. A package that fails keeps its error in its row (or a red band above the catalog with **Try again**) while the rest go on.
- A new npm version of an MCP server is found by its row's **Check**.

Even Keel's own plugins are a part of its version: after an update, every one of them in the catalog that is not removed gets its new version by itself within a minute, with no **Update** press, including one turned off in a project. A running task stays on the version it started with until it is done.

For sessions you start by hand, a marketplace added from the local path of Even Keel's folder offers the new plugins by itself, but Claude Code keeps its own copy of each plugin it installed: run `claude plugin update tasks@even-keel --scope project` (or `huly@…`, `github@…`, `linear@…`, `tally@…`) in each project repository that installed it. A marketplace added from a git URL needs `claude plugin marketplace update even-keel` first.

## Stored state

The projects, the settings, the chain's state, the questions posted to the tracker, the launch log and the handoff snapshots live in one database, the folder `state/even-keel/`. Its `memory/` subfolder holds the git repositories of the projects' memory; the backups copy it with the database.

Next to it, `state/machine/` holds what the part that runs sessions keeps: account registrations, management keys, account limits and transferred settings, CLI choices, and pending messages to the hub. Keep this folder when moving the installation: the database backups below do not include it. Stop Even Keel before copying it. If it is lost, Even Keel recreates it from what the database still holds of it; account changes made since and pending messages are lost.

A new version may store the files of `state/` in a newer format: at startup, before anything else, Even Keel rewrites them to it and keeps each old file next to it as `<file>.v<N>.bak` (the log names them). It rewrites all of them or none.

When the service cannot open its state, it runs with only the page, which shows the reason:

- **A file or a database written by a newer version**, or a file it cannot read: put back the version that wrote it, or restore a backup.
- **Another process holds the database**: the page names that process and the service tries again every 3 seconds. Wait for a backup or another reader to finish, or close the other Even Keel instance; once the database is free, the service starts and the page reconnects by itself.
- **Any other storage error** stays on the page until it is fixed and the service is restarted.

## Backups

This copies the hub database and the built-in tracker's attachments, also while Even Keel runs:

```sh
npm run storage -- backup <new folder>
```

For a move, keep `.env`, `state/machine/` and the agent account folders as well. To restore, stop Even Keel and put the folder in place of `state/even-keel`. A copy holds the trackers' tokens and keys in plain text: keep its folder as private as `.env`.

Even Keel also makes such a copy itself, once a day and at the start of a new version before it changes the database:

- Each copy is opened back in a temporary folder and compared with the database before it counts; one that does not open whole is removed, and a failure shows a banner on every page while the older copies stay.
- The copies go into `state/backups/`, next to `state/even-keel/`, named `even-keel-auto-<date>-<time>-v<schema>`, and the newest 14 are kept. Folders of other names in it, such as your own backups, are never removed.
- Settings → **Backups** shows the last checked copy, makes one at once, and sets **Copies folder** (an absolute path; a folder on another disk survives this one) and **Copies to keep** (1–365).

### Memory mirror

Settings → **Backups** → **Memory mirror** copies the projects' memory to a git repository of yours elsewhere, so it outlives this computer. Give **Mirror repository** an address git can push to, such as `ssh://git@git.example.com/you/memory.git`.

- Each project's memory goes into its own branch, named by the project's id, after every change and when Even Keel starts.
- Git signs in by your SSH key or its credential helper: an address with a password is refused.
- Make the repository private, since the memory may hold personal notes: Even Keel cannot check it and shows a warning while the mirror is on.
- A failed push is a line in `logs/even-keel.log` and is tried again at the next change.
- Even Keel never overwrites a branch there that has commits of its own: the page then warns that the mirror no longer gets that project's memory, until you merge or delete the branch.
- When this computer has lost a project's memory repository, Even Keel makes it again from the mirror's branch at its start.

## The statistics database

The statistics database is versioned too: the collector brings its schema up to date on its first run after the update, step by step, each step in one transaction. On your own Postgres it does so only when its role owns the tables; otherwise it changes nothing and the log gives the statements to run and the role to run them as.

Going back to an older version does not undo that: the older collector stops on a newer database (one line in the log) and `/stats` says so, until you update again or restore a backup of the database taken before the update (`<state>/tally/pgdata` for the embedded one).

## Going back

After an update from the page that kept the storage format, **Revert** in the update window does all of this. Otherwise, by hand:

1. Stop Even Keel (as a service: stop the service). Stop it first: a running Even Keel may write over the restored files.
2. Put the previous version's code back: installed with npm, `npm install --global even-keel@<version>`; a clone, `git checkout <commit>`.
3. Put the `.bak` copies back in place of the rewritten files.
4. Start it again (as a service: `even-keel install`, or in a clone its install script).

What the newer version wrote since the update — launches, the chain's state — goes with the `.bak`. In a clone the checkout leaves git on a detached commit, so the next update starts with `git checkout main` before `git pull`.

To go back to a version from before the database, stop Even Keel and export the state into an empty folder and the config into its old file, then put the exported state files into `state/` before starting the old version:

```sh
npm run storage -- export <empty folder>
npm run storage -- config-export even-keel.config.json
```

## From an older version

What an update from an older Even Keel does once, by itself, and what is left to you:

- **State in files or SQLite.** The first start of a version with the database imports `state/even-keel.db`, or else the older `chain.json`, `questions.json`, `launches.jsonl` and `handoffs/`, in one go — all of it or nothing — and renames them to `<name>.imported`. The config file `even-keel.config.json` is imported the same way, once, and kept as `even-keel.config.json.imported`; a file put there later is not read (the log says so).
- **Tracker keys in `.env`.** On the first start the tracker variables in `.env` become each tracker's default profile, once, and the log says so; after that `.env` is not read for them:
  - Huly: `HULY_URL`, `HULY_WORKSPACE`, and `HULY_TOKEN` or `HULY_EMAIL` with `HULY_PASSWORD`;
  - GitHub: `GITHUB_TOKEN`; Linear: `LINEAR_TOKEN`;
  - GitLab: `GITLAB_TOKEN` and the optional `GITLAB_URL` (by default `https://gitlab.com`, the web address without `/api/v4`);
  - Jira: `JIRA_URL`, `JIRA_EMAIL` and `JIRA_TOKEN`, with the optional `JIRA_MCP_TOKEN` of the Jira plugin;
  - Forgejo: `FORGEJO_TOKEN` and the optional `FORGEJO_URL`, a profile per host (the host of `FORGEJO_URL` and of the projects' Forgejo remotes).
- **OAuth connections.** GitHub, Linear and GitLab OAuth connections saved by an earlier version are dropped: their MCP servers take the tracker profile's token.
- **CLI version.** An install from before v0.2 keeps **CLI version** on **Checked**. The warning kind `cli.versions` in `notices` is still accepted but turns nothing off: unchecked CLI versions are only in the event log now.
- **The label of tasks you run yourself.** An install upgraded from an earlier version keeps `Manual` (and, from v0.2, `Вручную`) in the **No tasks with labels** lists it had or relied on; a new install has none.
- **Statistics.** An install that already collected statistics keeps the database it collected into, with no question at start.
- **Older config files.** A file of an older Even Keel gives each project the tracker it ran on. `host` and `port` left in an older config are not imported, the log says so once: the address is `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`.
- **Run labels.** Tracker labels `<Provider> | <model>` are no longer read. In the projects that had run labels on, each open task's label moves into its own run once; the labels stay in the tracker as plain ones, for you to take off.
- **Model prompts by model alone.** Older keys that named only a model become rows matching that exact model on every provider.
- **Claude's way of running per account.** If you had picked `CLI --bg` or `Agent SDK` per account, **Execution** takes it over when every account agrees with `Auto` or every one was on the SDK; otherwise it is `Auto`, and the service log names each account whose way changed.
- **Saved trust pauses.** A pause saved by an older version keeps its commands with `claude` from PATH; check the CLI and the account yourself, or retry to get fresh commands.
- **Project memory in the database.** The first start of a version with the memory folders puts the memory the database held into `~/.claude-memory/<project>` and its git repository.
- **My skills.** Until v0.4 your skills were wrapped by **Add a package** → **My skills** into the package `my-skills@even-keel-skills`; Even Keel removes that package from every project by itself, and your skills reach sessions [without it](packages.md#your-own-skills).
- **The `checkpoint@even-keel` plugin.** If you installed it in Claude Code, run `claude plugin uninstall checkpoint@even-keel` in each configuration folder where it was installed.

## A clone that follows CI

For maintainers: a hub running from a checkout can rebuild after a green push. Use `service/rebuild.sh <green-sha>` for the systemd user service or macOS launch agent, or `service/rebuild.ps1 -Commit <green-sha>` on Windows. The checkout must already be at that commit. If the rebuilt service cannot start or answer, Even Keel rebuilds the previous running commit and shows both commits on the page; the next green push can try again. The setup is in [Rebuild after a green push](../service/platforms.md#rebuild-after-a-green-push), the steps and the update log in [Rebuild mode](../service/updates.md#rebuild-mode).
