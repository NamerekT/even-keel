# Updating

From the page, by hand, trying the next version, plugins, stored state, going back.

## Updating

Docker installations update by [pulling the image](docker.md#updating).

A hub running from a checkout can rebuild after a green push. Use `service/rebuild.sh <green-sha>` for the systemd user service or macOS launch agent, or `service/rebuild.ps1 -Commit <green-sha>` on Windows. The checkout must already be at that commit. If the rebuilt service cannot start or answer, Even Keel rebuilds the previous running commit and shows both commits on the page. The next green push can try again. See [Rebuild mode](../service/updates.md#updating-from-the-page-btn-163-srcupdates) for setup and the update log.

The gear menu in the header ends with the installed version.

Even Keel asks GitHub for its latest release at start and every 12 hours (a request to `api.github.com` without a token; it names only the installed version), though never before the first start's setup is through and only if you allowed it on the setup's step; change that answer in **Settings → Interface**. A newer release gets a mark next to the version and a notification in the corner of the page.

Turn the check off on `/settings` → **Interface** or with `"updates": { "check": false }` in the config.

## From the page

The mark and the notification open the update window: the installed version, the notes of every newer release, and **Update to &lt;version&gt;**. A release marked as a revert release (its notes have a **Reverted** section) says what of an earlier release it takes back. The update:

1. waits, up to 5 minutes, until no chain is starting a session, handing over or closing a task — a restart in that moment would pause the chain; the page shows which projects it waits for. A chain held by an account or model limit, with no current task or closing, does not delay the update if the reset is more than a minute away, or unknown for a model's week;
2. stops the service, checks out the release's tag (`git fetch --tags`, `git checkout`), runs `npm ci` and `npm run build`, and starts the service again; installed with npm, it runs `npm install --global even-keel@<version>` into the same global folder instead;
3. waits up to 2 minutes for the service to answer with the new version and keep running.

If any step fails, including no answer, it checks out the commit it started from, installs and builds it again (with npm: installs the version it started from) and starts the service: you are back on the version you had. Either way the page reloads by itself and says how it went; **Details** shows the failed step and its output, and the whole log is `logs/update.log` (the outcome itself is in `logs/update.json`). Running sessions are not touched.

The button is there only when Even Keel runs as a service and its folder is:

- a global npm install, or
- a clean git checkout on the tag of the installed version; a clone that you update with `git pull` on the main branch is one.

Otherwise the window says why and you update by hand. A checkout that was on a branch stays on it (moved to the new tag), so a later `git pull` still works.

After an update the window and the gear menu also offer **Revert to &lt;previous version&gt;**, the same process in the other direction, as long as the update did not change the format of the stored state.

When it did, the older version cannot read the state any more: the window says so, and going back is the manual way below, losing what was written since. In that case it is better to wait for a revert release, which keeps the new format.

After a revert the newer release is offered again; nothing updates by itself.

Once the version is changed by hand (below), the window no longer shows how the last update from the page went, nor offers to revert it.

## By hand

Running sessions are not stopped by any of this: they belong to the CLI's daemon, and the restarted Even Keel picks them up.

**Installed with npm.** This stops the service, installs the latest release into the same global folder and starts the service again:

```sh
even-keel update
```

`even-keel update 0.2.0` installs that version. A release candidate from `npx even-keel@next` moves to the newer of the latest release and the latest candidate; when nothing is newer, the command says so and leaves the service running. Unlike the button it does not wait for the chains, and a failed install leaves the version you had.

Run from a terminal, not as a service: stop Even Keel, then start it again after

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

The plugins come with the code; `agent-bridge` is built in and on in every project, so there is nothing to add for it.

Chain sessions run the version of a package installed in **Settings → Packages**: its row shows the newer version the marketplace has and an **Update** button, or **Check** in its details when it knows of none (for a git URL marketplace both run `claude plugin marketplace update` first). Above the catalog, **Check all** fetches the plugins' marketplaces again and only shows the newer versions; **Update all** then presses every row's **Install** and **Update** in turn, and a package that fails keeps its error in its row (or a red band above the catalog with **Try again**) while the rest go on. The button shows which package of how many it is on, and leaving the section does not stop it. A new npm version of an MCP server is found by its row's **Check**.

Even Keel's own plugins are read from this folder and are a part of its version: after an update, every one of them in the catalog that is not removed gets its new version by itself within a minute, with no **Update** press, including one turned off in a project. A running task stays on the version it started with until it is done.

For sessions you start by hand, a marketplace added from the local path of this folder offers the new plugins by itself, but Claude Code keeps its own copy of each plugin it installed: run `claude plugin update tasks@even-keel --scope project` (or `huly@…`, `github@…`, `linear@…`, `tally@…`) in each project repository that installed it. A marketplace added from a git URL needs `claude plugin marketplace update even-keel` first.

If you installed the former `checkpoint@even-keel` plugin in Claude Code, run `claude plugin uninstall checkpoint@even-keel` in each configuration folder where it was installed. There is no need to install agent-bridge by hand: Even Keel supplies it to chain sessions, and its hooks stay silent in sessions started by hand.

## Stored state

A new version may store the files of `state/` in a newer format: at startup, before anything else, Even Keel rewrites them to it and keeps each old file next to it as `<file>.v<N>.bak` (the log names them).

It rewrites all of them or none; a file it cannot read, or one written by a newer version, leaves the service with only the page, which shows the reason.

The projects, the settings, the chain's state, the questions posted to the tracker, the launch log and the handoff snapshots live in one database, the folder `state/even-keel/` (PGlite, the embedded Postgres the statistics use too). Its `memory/` subfolder holds the git repositories of the projects' memory; the backups copy it with the database.
Next to it Even Keel keeps `state/machine/` for the part that runs sessions. It holds account registrations, management keys, account limits and transferred settings, CLI choices, and pending messages to the hub. Keep this folder when moving the installation: it is not included in the database backups below. Stop Even Keel before copying it. If it is lost, Even Keel recreates it from the rows retained at the original migration; later machine-only changes and pending messages are lost.

An Even Keel from before it kept them in a SQLite file `state/even-keel.db` or, earlier, in files: the first start of this version imports `even-keel.db`, or else `chain.json`, `questions.json`, `launches.jsonl` and `handoffs/`, in one go — all of it or nothing — and renames them to `<name>.imported`.

The config file `even-keel.config.json` is imported the same way, once, and kept as `even-keel.config.json.imported`; a file put there later is not read (the log says so).

A database written by a newer version leaves the service with only the page, like a newer file.

If another process holds the database when Even Keel starts, the page names that process and the service waits, trying again every 3 seconds.

Wait for a backup or another reader to finish, or close the other Even Keel instance.

Once the database is free, the service starts and the page reconnects automatically; no restart is needed.

A different storage error stays on the page until it is fixed and the service is restarted.

This copies the hub database and the built-in tracker's attachments, also while Even Keel runs. For a move, keep `.env`, `state/machine/` and the agent account folders as well:

```sh
npm run storage -- backup <new folder>
```

To restore, stop Even Keel and put the folder in place of `state/even-keel`.

Even Keel also makes such a copy itself: once a day, and at the start of a new version before it changes the database.

Each copy is opened back in a temporary folder and compared with the database before it counts; one that does not open whole is removed, and a failure shows a banner on every page while the older copies stay.

The copies go into `state/backups/`, next to `state/even-keel/`, named `even-keel-auto-<date>-<time>-v<schema>`, and the newest 14 are kept.

**Settings** → **Backups** shows the last checked copy, makes one at once, and sets **Copies folder** (`backup.dir`, an absolute path; a folder on another disk survives this one) and **Copies to keep** (`backup.keep`, 1–365).

Folders of other names in it, such as your own backups, are never removed.

**Settings** → **Backups** → **Memory mirror** copies the projects' memory to a git repository of yours elsewhere, so it outlives this computer: give **Mirror repository** (`memoryMirror`) an address git can push to, such as `ssh://git@git.example.com/you/memory.git`. Each project's memory goes into its own branch, named by the project's id, after every change and when Even Keel starts. Git signs in by your SSH key or its credential helper: an address with a password is refused. Make the repository private, since the memory may hold personal notes: Even Keel cannot check it and shows a warning while the mirror is on. A failed push is a line in `logs/even-keel.log` and is tried again at the next change. Even Keel never overwrites a branch there that has commits of its own: the page then warns that the mirror no longer gets that project's memory, until you merge or delete the branch. When this computer has lost a project's memory repository, Even Keel makes it again from the mirror's branch at its start.

A copy holds the trackers' tokens and keys in plain text: keep its folder as private as `.env`.

To restore one, stop Even Keel and put it in place of `state/even-keel`, as above.

The statistics database is versioned too: the collector brings its schema up to date on its first run after the update, step by step, each step in one transaction.

Going back to an older version does not undo that: the older collector stops on a newer database (one line in the log) and `/stats` says so, until you update again or restore a backup of the database taken before the update (`<state>/tally/pgdata` for the embedded one).

On your own Postgres the collector migrates as `tally_writer`; if it is not the owner of the tables, it changes nothing and logs the statements to run and the role to run them as.

## Going back

After an update from the page that kept the storage format, **Revert** in the update window does all of this. Otherwise, by hand:

1. Stop Even Keel (as a service: stop the service). Stop it first: a running Even Keel may write over the restored files.
2. Check out the previous version's code (`git checkout <commit>`).
3. Put the `.bak` copies back in place of the rewritten files.
4. Start it again (as a service: run its install script).

What the newer version wrote since the update — launches, the chain's state — goes with the `.bak`. The checkout leaves git on a detached commit, so the next update starts with `git checkout main` before `git pull`.

To go back to a version from before the database, stop Even Keel and export the state into an empty folder and the config into its old file, then put the exported state files into `state/` before starting the old version:

```sh
npm run storage -- export <empty folder>
npm run storage -- config-export even-keel.config.json
```
