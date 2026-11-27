# The page

Packages are shown in two places, the catalog and a project's packages, sharing their rows (`web/src/tools/PackagesParts.tsx`, grouping and problems in `packageGroups.ts`). `/tools`, the "What sessions get" page (`docs/sessions/tools.md`), lists no packages but links to them. Every change is a command sent at once, never a settings draft: `POST /api/packages/<command>`; the data is `EvenKeelState.packages`.

| Command | What it does |
| --- | --- |
| `install` | installs a package with no install or a failed one |
| `update` | Update, and a row's Check |
| `check` | "Check all" (`Packages.checkAll`) |
| `remove` | removes a package |
| `marketplace` | `claude plugin marketplace add <checkout>` for Even Keel's own marketplace |
| `plugin`, `server` | adds a plugin or an MCP server, for every project or one (`project`) |
| `import` | takes the servers of a repository's committed `.mcp.json` |
| `project` | a project's switch: `on`, `off`, or `null` back to the shared choice |
| `default` | the switch "Default" |
| `scripts` | the switch "Install scripts" |
| `setting`, `key` | a setting's value; a `.env` key |

## Rows and groups

- **Groups.** By source: Even Keel's marketplace first, the other marketplaces by name, then the MCP servers; the marketplace is named in the group's head, a row shows the plugin's short name.
- **A row** is one line at any width — a fold toggle with the name (ellipsis), the version muted with `→ <latest>`, the controls at its right — and opens to its details. In a narrow group (a container query) a row's version goes under its name with the buttons beside both, so neither the name nor "→ latest" is cut (BTN-1485).

## The catalog

The group "Packages" of the shared settings (`/settings`, `PackageCatalog.tsx`); `/settings?package=<name>` opens the group with that row open.

- **The head** has "Check all", "Update all" and "Add a package"; on a narrow screen its buttons go under the title.
  - "Check all" runs `claude plugin marketplace update` once per fetched marketplace of an installed plugin and drops the cached offers, so the rows show the newer versions; it installs nothing, and an MCP server's npm version is found only by its row's Check.
  - "Update all" (EKR-127) presses every row's Install and Update in turn (`pendingCommands` of `packageView.ts`), going on past a failure; a failed install shows in its row, any other failure — a command refused before the service logged it, a page that lost the service — as a red band above the groups with "Try again" for that row. The run lives in `web/src/tools/updateAll.ts`, outside the catalog (BTN-1480): leaving the section does not stop it, and the catalog mounted again shows where it is — the button says "Updating 2 of 3" with a spinner, the row it is on is busy and the rows after it wait — and what failed, until the next run or a reload. An install drops the package's cached offer (`installNew`), so a row loses Update as soon as the install lands, not a minute later.
- **Above the groups:** the gateway's error; a red band per problem (a failed install, and each enabled cell's problem over all projects, once each; `probing` and `unsupported` stay quiet) with "To the package", which opens and scrolls to its row; the offers to import the servers of a repository's committed `.mcp.json` (dismissed in `localStorage` until the list changes).
- **A row's right:** Install while not installed or failed, Update with a newer version, the switch "Default".
- **Its details:** the servers and the "skills and hooks" tag, the error and the last note, the settings' shared values, the keys its servers read, Check and Remove. The keys no package reads — only a tracker's server — are a card "Tracker keys" below.
- **"Install scripts"** — a switch in the details of a package with a pinned server (`PackageView.scripts` is `null` otherwise), whose tip warns the scripts run as the service's user (`files.md`, "Servers and npm").

### Even Keel's marketplace in Claude Code

Chain sessions get Even Keel's plugins without it, but sessions started by hand need the marketplace registered in Claude Code (`files.md`, "Where a plugin comes from"). `/accounts` offers the registration in the Claude Code card before Add (`AccountMarketplace`, EKR-62), and a quiet check mark once the global configuration knows it (`PackagesView.marketplace.known`); both states have a tip with the registration and plugin-install commands. The action is `packages/marketplace`; a missing executable gives `packages.marketplaceCliMissing`, other failures `packages.marketplaceAdd`. With no Claude account, or no own marketplace, there is no action. The catalog has no registration offer and there is no local dismissal.

## A project's packages

A dialog over the project's page at `/p/<id>?pkg=1` (`ProjectPackages.tsx`), so the settings panel's hash stays under it and a link leads straight in. At 760 px and below it takes the whole screen.

- **Opening it.** "Project packages", the full-width button of the panel's Sessions tab before the Agent section (BTN-914, `PackagesButton.tsx`; packages do not depend on the provider), opens it through `packagesOver`, which keeps the address's parameters (the machine's view) and hash, so the panel stays under it and "Done" comes back to it (BTN-1301). The button is one line: the short names of the enabled packages (`enabledPackages`, `shortName`) cut with an ellipsis, "none turned on" without any, or — amber while `projectIssues` has any — the first problem as the dialog names it and "N more"; the whole list is its tip. "What the session gets" keeps the fact "Packages" as a reference, without a button.
- **Shown:** the project's tracker's plugin, the `tasks` plugin where it serves the tracker, and every enabled package; Even Keel's plugins of other trackers that are off fold into "N more".
- **A row's right:** the inheritance chip ("shared", or "own" with ↺, which sends `choice: null`) and the switch (`packages/project` with `on`/`off`), a spinner while `probing`.
- **On top:** a red band per problem of `projectIssues` (the set's, then each enabled package's) linking to its row. The tracker's bands are in "The tracker's package in two clicks" below.
- **The details:** what it brings, the row's problems with their tips, the settings for this project (an empty field takes the shared value, its placeholder), and "To the catalog" for install, update and keys.
- **The foot** has "Add to the project" (the add dialog with the project) and "Done".

## Adding a package

"Add a package" opens a dialog (`AddPackage.tsx`): the kind first, then a plugin of Even Keel's or a known marketplace, or an MCP server — a name, an address with headers (`Name: value` lines) or a command with its environment (`NAME=value` lines, a quoted argument kept whole). From the catalog the package is on in every project (`default`); from a project's packages it is on only there (`project` of `packages/plugin` and `packages/server`, off by default elsewhere). The user's own skills are no package (`files.md`, "The user's own skills").

## The tracker's package in two clicks

EKR-5, `trackerPackage` in `web/src/tools/packageView.ts`, `packagesPath` in `packageGroups.ts`.

- **The choices.** A missing tracker package comes as `choices`, the default first (BTN-874): Even Keel's `tasks` where it serves the tracker (`also`), then the tracker's own plugin. Each choice is the catalog's installed package of that server to turn on (`name`) or Even Keel's plugin of it to add (`plugin`); a server with neither is no choice. The tips say how they differ (`choiceTip`): the tracker's own server has more tools and context and works without the service; `tasks` has five tools and needs the service running.
- **The ways there.** The settings button and the chip go to the first choice; the pause's buttons and the project's packages offer each:
  - "Project packages" beside "Task description in the prompt" in the project's settings — active while no package of the project brings the tracker's server, whatever `brief` is, greyed with the package that does in its tip otherwise (on `/settings` there is no project, so no button);
  - the "What sessions get" chip in the project page's head (`ToolsChip` in `web/src/pages/ToolsLink.tsx`), whose count adds `noTrackerMcp` to the settings problems and whose tip says the chain waits (`brief` off) or advises a tracker package (auto or on), and warns while both servers are on (then it leads to the project's packages); with nothing missing and nothing doubled it leads to `/tools?projects=<id>`;
  - the buttons of `chain.noTrackerMcp` (`TrackerFixButtons.tsx`), one per choice;
  - in the project's packages, `noTrackerMcp` as a band with a button per choice ("Add tasks@even-keel", "Turn on huly@even-keel"), each with the line on how it differs in its tip, and a missing tracker package without the problem (`brief` auto or on) as a note band with the same buttons. An amber band says when both the tracker's own server and the tasks server are on (`trackerDoubled`), with "Turn off tasks" beside it, which turns the enabled package that brings the tasks server off for the project (`packages/project` with `off`, BTN-1028).
- **What a button does.** It turns its installed package on at once or opens the add dialog on its plugin. When the catalog has the first choice installed but the project has it off, the settings button and the chip open the project's packages without `add`, where its switch turns it on.
- **The add address.** `/p/<id>?pkg=1&add=<plugin>@<marketplace>` opens the project's packages with the add dialog over them on its plugin step (`AddPlugin`), opened only after them, or it would end up under them. With at least one Claude account and while Claude Code does not know Even Keel's marketplace (`marketplace.known === false`), the dialog first asks to add it — "Yes, add" runs `packages/marketplace`, "No" goes on, and either way the plugin step follows, since chain sessions do without it. Closing it drops `add` with a replace, and a plugin no longer in `available` (the catalog has it already) only drops it; closing the packages drops both.
- On `/tools` a failed MCP server's fix (`mcpFailed`) links to each project's packages.
