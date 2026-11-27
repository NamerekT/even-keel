# What the tests keep on disk

## Database templates

Tests use `memoryDatabase()` (`src/storage/memory.ts`): an independent copy of a database migrated once per run, closed when its test ends.

- `test/pglite-template.ts` builds a fresh cluster, the SQLite import's v3 schema and the current schema with the real steps, then saves each closed folder and its `dumpDataDir` dump.
- `test/pglite.ts` starts raw PGlite clusters from the fresh copy; its test-only `openDatabase` uses a migrated template only for a new database and the exact standard steps for v3 or the current schema. Existing databases, every frozen SQL sample and custom steps take the original migration path.
- In-memory copies use `loadDataDir`; disk copies use `test/copy-template.ts`, which scans each template once and copies its files asynchronously. A copy asks for a filesystem reflink where there is one and falls back to an ordinary copy; there are no hard links.

How the frozen samples of the steps are tested is in [`steps.md`](steps.md).

## The run's temp folder (BTN-1316)

A vitest run has a temp folder of its own, so tests that never delete what they create in `os.tmpdir()` leave nothing in the OS one.

- **Where.** `test/temp-setup.ts`, the first global setup, creates `<OS temp>/even-keel-tests/<pid>-<6 chars>/` with `run.json` (pid and start time) and points `TEMP`, `TMP` and `TMPDIR` of `process.env` at it before the pool starts: the workers, their child processes (the e2e service, git, CLI stubs) and the PGlite templates all write there. The root stays in the OS temp, not the checkout's `.temp/`, because tests create git repositories and folders outside any repository; the names are short for Windows' `MAX_PATH`.
- **Keep the folder's name and place**: an antivirus exclusion of a developer's machine may name exactly `even-keel-tests` in the OS temp.
- **The teardown** removes the root; what a live child process still holds stays, with one warning line and the count of entries left, and the run does not fail.
- **The sweep.** At its start each run removes what interrupted runs (Ctrl+C, a killed session) left: another run's folder goes when its pid is not alive or it started more than 24 h ago (a pid may be reused), a folder without `run.json` by its own age over 24 h; a live run in another worktree is never touched (`isStale`, `test/temp-root.ts`). Folders outside `even-keel-tests` are never swept: some share common names with other programs.
- **A child with an environment of its own**, without `...process.env`, gets `TEMP`, `TMP` and `TMPDIR` passed on (`src/packages/gateway.test.ts`).

## Git templates (BTN-1483)

A git repository a test builds the same way every time (`init`, its config, a first commit, a bare remote with clones) is built once per run and copied whole: on Windows each git process is costly, and an antivirus checks every one whatever the exclusions.

- `copyRepository(name, folder, build)` (`src/git/template.fixture.ts`) runs `build` once in a folder of its own under `<run root>/git-templates/`, renamed into place whole, so the workers of one run share it. Each call copies it with `cpSync` and turns the build folder's paths in git's `config`, `.git` and `gitdir` files into the copy's (`retarget`: plain, doubled backslashes, forward slashes).
- One `name` means one build: the e2e `Harness` names its kind by the checkouts it asks for (`e2e-forge-second`).
- What a test checks — git's own behaviour, a history of its own — stays on git.
- To count git processes, set `GIT_TRACE2_EVENT` to a folder per test file from a setup file (`expect.getState().testPath`): git writes a file per process there, children's `sid` with a `/`. A wrapper on `PATH` does not work: `execFile` does not find one without `.exe`.
