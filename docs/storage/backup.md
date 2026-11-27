# Backup, export, rollback and the memory repositories

## What a copy holds

A backup holds the settings and projects, the trackers' profiles with their secrets and the OpenRouter management keys in the clear: keep every copy, hand or automatic, as private as `.env`. `closed_tasks` has no file: only a backup keeps it. Besides the rows, a copy takes the attachments' bytes `files/` (without half-written uploads, so every record finds its file) and the memory repositories `memory/` without git's `*.lock` files.

For a move also keep `state/machine/` with the service stopped, and the agent account folders: the hub's backup has the machine's rows only as they were when the machine's database took them over ([`steps.md`](steps.md#the-machine-databases-steps)).

## The commands

`npm run storage -- <command>` reads the database of `EVEN_KEEL_STATE_DIR` (the checkout's `state/` by default; `.env` is loaded) through `readStateDatabase`.

- `backup <dir>` — a copy into a new folder laid out like `state/even-keel` (`<dir>/pgdata`), also while the service runs: all tables are read in one statement (`rowsOf`), so the copy is consistent, and written into a fresh database (`backupDatabase`, `src/storage/copy.ts`); then `files/` and `memory/`. To restore, stop the service and put the folder in place of `state/even-keel`.
- `export <dir>` — the state as the v0.1 files, into an empty folder. A v0.1 Even Keel reads them, and so does the import. To roll back: stop the service, export, put the files into `state/` of the old version and the settings as its `even-keel.config.json` (`config-export`).
- `config-export <file>` — the settings and projects in the config's format, into a new file (`exportConfig`). No profile and no secret goes into it.
- `config-import <file>` — such a file, of any schema version, in place of the settings and projects, whole: a key it lacks goes back to its default, a project it lacks goes with its setting rows (`importConfig`, writer `hand`); the profiles and `projects.profile_id` stay as they are. The file is read and checked before anything is written. It goes through the port of a running service, which picks it up at its next look (`ConfigStore`, every 2 s). It is the way to edit the settings by hand: export, edit, import.

## The automatic copies (BTN-1083, `src/storage/backup.ts`, `backup-schedule.ts`)

- **When.** The service looks 5 min after its start and then every 10 min. When the newest checked copy is older than a day (`BACKUP_EVERY_MS`) it makes one; a failed one is tried again after an hour.
- **How.** The rows are read in the service's thread (`rowsTextOf`, one statement, as the hand backup) and handed to a worker thread (`backup-worker.ts`), which writes the copy into `even-keel-auto-<YYYYMMDD>-<HHMMSS>-v<schema>`. Run from the sources, the worker gets tsx's loader as its only flag, since under vitest, as in e2e, it inherits none (BTN-1259).
- **The check.** A trial restore copies it whole into a temporary folder, opens it, compares the schema version and each table's row count with what was read, and hashes every attachment `builtin_files` names. Only then `check.json` (`CopyCheck`: time, version, rows per table, files) is written into the copy: a folder without it is no checked copy. A failed write or check removes the copy and leaves the older ones.
- **Rotation** (`rotate`) keeps the newest `backup.keep` checked copies, removes older checked ones and unchecked ones older than the newest checked, and touches no folder of another name, so a hand backup next to them stays.
- **The folder** is `backup.dir`, or `backups/` in the state folder (`backupDirOf`); both settings are read at each copy, so a change applies at the next one. The page's save refuses a `backup.dir` that names an existing file (`checkCopiesDir`, `config.backupDirFile`). A folder that later turns into a file or cannot be read has no copies (`ownCopies`), so the page's state still builds and shows the failed copy's banner (BTN-1179).
- **Restore**: as a hand backup, the layout is the same.

## Before schema steps

At the start, when an existing database is about to take new steps (an update), `openDatabase` calls `copyBeforeSteps` first. The copy is made and checked in the start's own thread on the old schema, named with the old version, and rotated with the rest (the settings read from their rows as they are). A failure is logged and does not stop the start; the service shows it until a copy succeeds.

## What the page gets

- `backup` of the state (`BackupView`): the folder, the newest checked copy's time, whether one runs, the failure as `storage.backupFailed` or `storage.backupCheckFailed`.
- The command `storage/backup` starts one at once, refused with `storage.backupRunning` while one runs.
- The page shows them on the "Backups" tab of Shared settings and the failure in a banner over every page (`BackupBanner`).
- The service's stop aborts a copy under way: the worker is terminated and its half-written folder removed, with no failure shown. A crash mid-copy leaves an unchecked folder that the rotation after the next copy removes.

## The memory repositories (BTN-1646)

`state/even-keel/memory/<project id>.git` is the bare git repository of each project's memory (`memoryDirOf`, `MemoryHub` in `src/memory/git/hub.ts`, `docs/sessions/memory.md`, "The hub's repositories"). The service owns them as it owns the database beside them: only its working copies push into them, nothing else writes there. A repository is made at a project's first working copy and stays after the project is removed.

Beside them, `memory/config.git` holds the user's global Claude Code configuration (BTN-1690, `docs/sessions/memory.md`, "The global configuration"), made at the service's start. Its working copy `~/.claude-config` pushes its history into a missing one the same way.

- **Backup.** Every copy takes `memory/` after the rows. A copy taken while a sync pushes may miss that push; the working copies hold their whole history and push it again at their next sync.
- **Restore on another host.** `memory/` moves with `state/even-keel`; the hub's memory folders need not move. A project whose repository is missing gets an empty one, and its working copy on the hub pushes its history into it. With neither the repository nor the old hub's memory folder, the memory starts empty: the transfer from `memory_records` is not repeated (`memory.transferred`).
