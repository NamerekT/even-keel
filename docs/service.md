# Service

How Even Keel is installed, run and updated as a service on Windows, Linux and macOS, for the sessions and contributors who change that code. Without the service, on any system: `npm install`, `npm run build`, `npm start` in the repository root. The npm package is the other install ([`platforms.md`](service/platforms.md#an-npm-install-btn-265)).

The Tally stats collector runs inside the service (every 5 minutes, in its own thread), so no separate scheduler or cron task is needed.

`src/service.ts` owns the order of initialization; its `src/service/` modules wire accounts and agents, chains and worktrees, trackers and intake, the HTTP and state view, stats and lifecycle. They share one context of getters, so a callback sees components initialized later and the latest sessions, config and address.

## Subtopics

The area is split by subtopic, a file each in `docs/service/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`start.md`](service/start.md) | What applies on the fly and what needs a restart; a failed start and its log lines, HTTP/1.1 only, the start's diagnostics (`start:` and `event loop:` lines, CPU and stall profiles), the rules that keep a start fast |
| [`platforms.md`](service/platforms.md) | Windows (the start at sign-in with the tray, the service `EvenKeel`), Linux and macOS (install, readiness check, stop and sessions), rebuild after a green push, the Docker image, an npm install, a machine of a hub |
| [`updates.md`](service/updates.md) | Updating from the page: who may, revert, settling, the update process and its steps, rollback, the outcome, rebuild mode, follow mode, containers |
