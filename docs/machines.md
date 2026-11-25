# Hub and machines

The hub decides, a machine runs the sessions; the map of the roles is BTN-137. Three steps of it are in the code: the seam between the two roles inside the service ("The seam"), the link that carries it (`src/link/`) and the chain over that link inside one process ("One process" and the sections after it). The fourth, the hub's door for machines elsewhere ("Machines elsewhere", BTN-1242), lets a machine join and get projects, and an installation that joined runs as a machine alone ("The machine's process", BTN-1247). **It does not run the chain's tasks yet:** the chain's work still goes only to the hub's own machine, the installation itself, reached through the same protocol over a carrier that is a call.

## Subtopics

The area is split by subtopic, a file each in `docs/machines/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`seam.md`](machines/seam.md) | The seam, one process, the machine's context, the brief and stores, the chain over the link, moves |
| [`pool.md`](machines/pool.md) | The mirror, tasks to machines, the pool, a task pinned to machines, past a limit |
| [`page.md`](machines/page.md) | The pool on the page, the machine's page, the machines panel |
| [`landings.md`](machines/landings.md) | The main branch on machines, a machine in a project, after a green main, landings, a machine gone, account limits |
| [`elsewhere.md`](machines/elsewhere.md) | Machines elsewhere: the hub's door for machines on other hosts |
| [`machine-side.md`](machines/machine-side.md) | Signing in on a machine, the folder's mark, the machine's process |
| [`link.md`](machines/link.md) | The link: two directions, MCP and hooks through the hub, numbers, pulse, proxy, token, what a command may touch, tests |
