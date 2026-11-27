# Hub and machines

The hub decides, a machine runs the sessions; the map of the roles is BTN-137. One installation is a hub and its own machine in one process, joined by the link (`src/link/`) over a call ("The seam" and "One process", `seam.md`). Other installations join the hub as machines elsewhere (`elsewhere.md`), each a process of its own over HTTPS (`machine-side.md`), and the hub's one chain runs a project's tasks on the machines of its pool, several at once (BTN-993, "The pool", `pool.md`).

## Words

| Word | Meaning |
| --- | --- |
| hub | the installation that holds the state database, the trackers, the page and the one dispatcher; it decides |
| machine | what runs the sessions: accounts, packages, working folders; reached only through `MachinePort` |
| own machine | the hub's own installation as a machine, in the hub's process (`ownMachine`, `LocalTransport`); it never loses its link |
| machine elsewhere | another installation that joined the hub (`even-keel join`) and runs as a machine alone (`src/machine-service.ts`, `wireMachineSide` with `alone`), over HTTPS |
| link | the protocol between a hub and a machine: commands down, events and snapshots up (`link.md`) |
| pool | the machines a project may run on (`project_machines`). Not the key pool of packages (`keyPool`) and not the accounts' shared pool (the `accounts` setting's shared entries) |
| lane | one running task of a project on one machine: an `ActiveChain` with its `machine` (`pool.md`, "The pool") |
| mirror | the hub's copy of one machine's facts, one per machine (`pool.md`, "The mirror") |
| facts | the values a machine computes for what the chain and the page read of it (`MachineFacts`) |
| catch-up | `MachinePort.catchUp`: the own machine posts what changed and the hub waits until it took it (`pool.md`, "Freshness") |
| hub brief | the command `hub.brief`: what the machine's assembly reads of the hub, sent whole (`seam.md`, "The brief") |
| launch brief | `LaunchBrief`: the task's text the hub sends with a launch; `TaskBrief` inside it is the task's fields for answers without the hub (`seam.md`, "The brief") |
| capacity, width | how many of the hub's tasks a machine runs at once; how many tasks of a project run at once (`pool.md`, "Two numbers") |

## Subtopics

The area is split by subtopic, a file each in `docs/machines/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`seam.md`](machines/seam.md) | The seam (`MachinePort`), one process, the machine's context, the hub brief and the launch brief, the machine's stores, the chain over the link, moves of a session and moves without the hub |
| [`pool.md`](machines/pool.md) | The mirror and its freshness, which posts read, the cost of the facts, tasks to machines, the pool (lanes, capacity and width, pulling, an account on a machine, the port by task), a task pinned to machines, past a limit |
| [`page.md`](machines/page.md) | The project's tab "Machines" and "Connect", the wizard's machines, the machine's page (capacity, colour, icon, git author, CLI versions), the machines panel and a machine's view |
| [`landings.md`](machines/landings.md) | The main branch on machines, a machine in a project, after a green main, landings across machines, a machine gone and "Reassign" |
| [`limits.md`](machines/limits.md) | Account limits across machines: one poller per claude.ai account, the plan, long tokens' limits |
| [`elsewhere.md`](machines/elsewhere.md) | Machines elsewhere: the door and the setting, the connection string and the request by the address, `even-keel join`, the installer and Docker, projects, mirror and brief, another build and coming to the hub's build, what a machine tells, the checked CLI, the page's API and the window "Add a machine" |
| [`machine-side.md`](machines/machine-side.md) | Signing in on a machine (the machine's accounts page, "Add account", installing a CLI, long tokens, API keys), the folder's mark (on the own machine too), the machine's process |
| [`link.md`](machines/link.md) | The link: two directions and the API version, MCP and hooks through the hub, numbers, pulse, proxy, token, what a command may touch, the hub's stores, tests |
