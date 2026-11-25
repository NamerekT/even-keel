# Service

Reference for sessions: installing and running the service on different systems. Without the service, on any system: `npm install`, `npm run build`, `npm start` in the repository root. The npm package is the other install: "An npm install" below.

The Tally stats collector runs inside the service (every 5 minutes, in its own thread), so no separate scheduler or cron task is needed.

`src/service.ts` owns initialization order and live state. Its `service/` modules wire accounts and agents, chains and worktrees, trackers and intake, the HTTP/state view, stats and lifecycle. Their context uses live getters (and setters for mutable state), so callbacks see later-initialized components and the latest sessions, config and listening address; the modules import the context type only.

## Subtopics

The area is split by subtopic, a file each in `docs/service/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`start.md`](service/start.md) | What applies on the fly, a slow start |
| [`platforms.md`](service/platforms.md) | Windows, Linux and macOS, an npm install, a machine of a hub |
| [`updates.md`](service/updates.md) | Updating from the page |
