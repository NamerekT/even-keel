# The demo on the first run (BTN-776)

A person who has just installed Even Keel can watch the chain work before connecting anything: a real service, a real chain, real git where it is installed and the built-in tracker, with a script in place of the agent. No account, no limits, no money.

## Where it is

| Part | Where |
| --- | --- |
| The service: make, check, start again, remove | `src/demo/service.ts` (`DemoService`), wired by `wireDemo` in `src/service/demo.ts` |
| The agent | `src/demo/agent.ts` (`DemoAgent`, over the shared core `src/agent/scripted.ts`), registered in `AGENTS` as `demo` |
| The scenario and its texts | `src/demo/scenario.ts` |
| The page | `web/src/pages/Demo.tsx` (`DemoWelcome`, `DemoNotice`), the checkbox in `ProjectAdd.tsx` |
| The routes | `demo/start`, `demo/again` (both take the page's `language`), `demo/remove` |
| The state | `EvenKeelState.demo`: `{ project, finished }` or `null` |
| The test | `src/e2e/demo.test.ts` ([e2e.md](e2e.md)) |

## What it is made of

- **The folder** `<state>/demo/`: the project's folder `repo/` and the agent's account folder `account/`, where `sessions.json` keeps its sessions. Nothing else marks the demo: a project is the demo's when its folder is `<state>/demo/repo` (`DemoService.project`).
- **The mode** is chosen as for a new project (EKR-108), on every start and "Run again": `defaultGit` `false` — without git; `true` or `null` — a repository, or without git when git does not start (`missing` on `git init`; logged, no error). The demo is never refused for want of git.
- **With git** the folder is a repository made fresh on the project's main branch (`DEFAULT_BRANCH`) with a README, a `.gitignore` of `.claude/worktrees/` and `.temp/`, and one commit, under a local name and `demo@example.com`. git that starts but fails in `init`, `config`, `add` or `commit` is `git.initFailed`.
- **Without git** the folder has only the README, and the project has `git: false`: its sessions work in the folder itself, one at a time, and a task closes by the `TASK DONE` mark (`docs/guide/chain.md#a-project-without-git`).
- Any failure while preparing the folder removes the whole `<state>/demo/` folder before returning the error; no project is made, and a later start can try again.
- **The project** `DEMO` (name Demo / Демо) on the built-in tracker, with `testProject` on (BTN-206): out of the launch chart, `/stats` and Tally. The run settings are the demo's whatever the config says (`runOf`): agent `demo`, account `even-keel-demo`; a task's run cannot take it off the demo agent, whose pool has no other account.
- **The account** `even-keel-demo` is listed by `AccountHomes` only while its folder exists (`setDemo`) and is never shown on the page: the accounts view filters it out, and the update check counts no demo project as the person's.
- **The tasks**, in the page's language at the start: DEMO-1 (a welcome line in the README), DEMO-2 (a changelog) blocked by DEMO-1, DEMO-3 (the tone of a greeting) which asks a question with two options. A task the person adds on the page (BTN-770) gets a short generic turn: a note under `notes/`.

## The scenario

Each turn reads, thinks and checks with pauses of 2–4 s (`PACE`), commits `[DEMO-n] <file>` on its branch and merges it into the main branch in the main checkout, as a session does; the chain then closes the task and starts the next. Without git (no `.git` in the project's folder) the turn writes its file in the folder, skips the commit and the merge, and ends with its answer and the line `TASK DONE` (the scripted agent's `done` end), which the chain puts on the task as a comment before closing it. DEMO-3's first turn ends with the question; the answer from the page's chat resumes the session, which writes the chosen tone. The agent speaks the language its task was made in (`languageOf` the prompt's title); a task the person added, the page's.

- **Deterministic**: the same pauses and texts every run, so `npm run shot` and the test see the same thing.
- **A restart** finds the sessions in `sessions.json`; a session found mid-turn plays that turn again (its steps are idempotent), so the demo goes on where it was.
- **Over** (`finished`) once at least three tasks are closed, none is open and the chain is off; read with the event log's beat (`hub.watch('state')`).

## The page

- **No project at all**: the home page is the welcome with two choice cards, each pressed anywhere (the look of the packages' kind cards, `add-package__kind`) — "Watch the demo" (`demo/start`, then the demo's project page) and the project's card: "Set up Even Keel and connect a project" while the first run's setup is not walked, a link straight to the step it stopped at with no question; "Connect your project", the project wizard, after it.
- **The demo's project page**: a band "This is the demo: the agent is a script, nothing is spent" with "Connect your own" and "Remove" in its ⋯ (a confirmation: the demo is still running); once over, the end card "The demo is over" with "Remove", "Run again" (`demo/again`) and "Connect your own".
- **The demo is none of the person's projects** (`ownProjects`): it does not end the first run, the project wizard shows the first run's line while only the demo is there, and the stats are asked about only once an own project exists.
- **The project wizard** shows "Remove the demo", on by default, while a demo exists; after the project is added the page sends `demo/remove`.

## Removal

The demo is never removed by itself. `demo/remove` (and `demo/again` before it makes a new one) stops the chain if it runs, drops the agent's sessions — a turn under way finds itself let go at its next pause (`TurnContext.live`) and writes nothing more — removes the project from the config, its built-in tasks, its launches, closed tasks and merge marks (`forgetProjectRows`, `MergeMarks.forget`), and deletes the folder. The three routes run one after another.
