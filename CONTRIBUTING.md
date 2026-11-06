# Contributing

Even Keel is open source under the [MIT license](LICENSE), but it is not open to contributions: pull requests are not accepted for now. One person builds it, with Claude Code sessions run by Even Keel itself, and every change goes through its own tracker first.

What helps most:

- **Stuck on setup** — an issue with the setup template: where installing or the first run stopped and what you expected. An unclear step is worth it even if you got past it.
- **A bug** — an issue with the bug template: what you did, what happened, the Even Keel version, the OS, the agent and its CLI version, the lines of `logs/even-keel.log` around it.
- **An idea** — an issue saying what you wanted to do and what got in the way, rather than how to build it.
- **A run into something listed in [docs/unverified.md](docs/unverified.md)** — an issue saying which entry and what happened, whether the assumption held or not. That is the report wanted most: these are the cases no check on the author's machine could reach.
- **A vulnerability** — privately, never as an issue: [SECURITY.md](SECURITY.md).

An issue is read and, if taken, copied into the project's own tracker; what is decided there is what gets built. A pull request opened anyway is closed with a pointer here — open an issue with the same idea instead, and link your branch if the code helps explain it.

Forks are welcome: the MIT license lets you change Even Keel and run your own copy however you like; [Extending](#extending) below says where a tracker adapter or a plugin goes. The name "Even Keel" stands for this repository: a fork that is published or sold goes under a name of its own and may say it is based on Even Keel. A bug seen only in a fork goes to the fork.

## Working on a clone

```sh
npm test            # vitest, without the end-to-end scenarios
npm run test:e2e    # the end-to-end scenarios of src/e2e/
npm run test:cli    # the same on the real checked CLIs with a scripted model, src/e2e-cli/ (downloads them once)
npm run typecheck
npm run dev         # the server, restarting on changes
npm run dev:web     # the page with hot reload, proxying /api to a running server
npm run dev:fake    # the page on fake data
npm run shot -- '?chain=ask' .cards   # a dark screenshot of an element on fake data, into .temp/shot/
```

## Extending

### Your own tracker

The chain never talks to a tracker directly: it reads tasks through an adapter. The contract, with what each field means and what to return when your tracker lacks something, is the JSDoc of [src/tracker/source.ts](src/tracker/source.ts) (`TrackerAdapter`, `TaskSource`). `src/github/` is a compact example, `src/huly/` a fuller one. Register the adapter in [src/tracker/adapters.ts](src/tracker/adapters.ts) and pick it with `tracker` in the config.

Optional parts:

- `brief` and `complete`: without them, sessions must learn the task and close it some other way;
- `card` and `ready`, the task card on the page and its **Move to Todo** button: without them the page links to the task in the tracker.

### A plugin for it

A plugin gives sessions the tracker's MCP server and a skill for working a task. Use [plugins/huly](plugins/huly) as the pattern:

1. `.claude-plugin/plugin.json`, `.mcp.json` with the server, `skills/task/SKILL.md`;
2. an entry in [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json);
3. the server's name in the adapter's `mcpServer`, so that Even Keel can check sessions see it.

When the server's `${…}` placeholder names the adapter's key differently, declare it in the adapter's `mcpKeys` (`{ LINEAR_API_KEY: 'LINEAR_TOKEN' }`), so the gateway fills it from the project's profile; a value built from several keys, such as Jira's Basic header, goes in `mcpValues`.

Raise the plugin's `version` on every change: installed copies are cached by version.
