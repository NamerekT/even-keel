# The JSON files that stay

The files of `state/` beside the database (the list is in [`storage.md`](../storage.md)) are written through `writeAtomic` (`src/storage/atomic.ts`): the account ledger, the Codex and Claude SDK session records, the package state, the CLIs' trust entries, the file migrations and the state export. The database's own writes do not go through it.

- **The write.** The new content goes into a temporary sibling file, which then replaces the destination by `rename`. A failed write removes its temporary file.
- **Windows.** `rename` retries `EPERM`, `EACCES` and `EBUSY` for up to 3 seconds, with synchronous pauses growing from 10 to 100 ms, so a write stays whole while a virus scanner or another reader briefly holds the destination. Other errors fail at once. The same retries rename the import folder at the first start (`renameOver`, [`first-start.md`](first-start.md)).
- **Readers in the service read synchronously** (BTN-499). An asynchronous read keeps the file open until the event loop gets to close it, and the synchronous retries of a rename hold the event loop for their whole window, so the rename would wait on a file its own process keeps open. The Codex and SDK registries therefore read and list their session JSON with synchronous calls behind their Promise interfaces.
- **Permissions off Windows.** The replaced file keeps its mode: the temporary file is created owner-only and then given the old mode, so a `600` file does not turn `644` under the umask (EKR-95). A caller may name the mode instead: `state/packages.json` is `600`, since a package's settings may hold a token.

The Windows reproduction and the registry stress check are rows of [`verified/sessions.md`](../verified/sessions.md).
