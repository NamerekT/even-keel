# A machine of a hub (preview)

The first installation is the hub: it has the page, the trackers and the chains, and runs sessions itself. Another computer can join it as a machine: an installation with no page and no projects of its own that the hub gives projects to. The hub gives the chain's tasks to the machines of each project's pool.

**Preview:** joining, running tasks to Done and project chats on machines are checked in Docker and from npm on Linux; the machine installer on Windows and macOS and a hub behind a real proxy are not checked yet.

## Joining a machine

1. On the hub, press **+ Machine**: at the foot of the machines panel, which opens from the machines block in the header, or, while the hub is the only machine and there is no panel yet, in **Settings → Machines** under **Hub address for machines**.
2. In the window, pick the **Hub address for machines** — the name or IP the other computer reaches the hub by: one of the page's names, an address of a network adapter, or one you type. Give the machine a name if you like (without one it is named by its host name) and a colour (the next free one is offered). **Issue the command** remembers the address for the next machines; the hub then listens for machines on port 4749 (`EVEN_KEEL_MACHINES_PORT`). The window shows the command with the hub's address first, and under **Or with the connection string** the same command with a string instead: good for 30 minutes and one machine; **Issue again** takes back the one not used yet.
3. On the other computer, with Node.js 24 and git installed, run the command the window gave, the same on Windows, Linux and macOS:

   ```sh
   npx even-keel@<the hub's version> install --machine <the hub's address>
   ```

   The machine asks the hub to let it in and prints a code, such as `K7Q-4M2`.
4. On the hub, every open tab of the page shows the window **A new machine wants to join**: what the machine told about itself (its name, system, Docker or not, the folder of projects, the address it came from) and the code. Compare the code with the terminal: the same code means nothing stands between the machine and the hub, so press **Admit**; another code, or a machine you did not start, **Decline**. A request waits 10 minutes; declined or expired, the command says so and stops.

The command installs the package globally, joins the hub and installs the service the same way as for a hub: on Windows the start at sign-in with its tray icon (add `--service` for the Windows service `EvenKeel`, from PowerShell 7 as administrator, as in [Windows: without a sign-in](service.md#windows-without-a-sign-in)), on Linux and macOS the user service. It then waits up to 30 seconds for the machine to reach the hub and says whether it did. Without Node.js 24 or git it installs nothing and says what is missing. Run it again (an update, a failed install) with the same address or string: the machine stays joined and only the service is installed again.

- **The connection string** is for a machine that cannot reach the hub by the address you picked, and for scripts, where no one is at the page: `npx even-keel@<the hub's version> install --machine <connection string>` joins at once, with no window on the hub.
- **An installed Even Keel** joins the same way with `even-keel join <the hub's address>`.
- **`--root <folder>`** names the folder the machine's projects go into (by default `projects` in its data folder); the hub puts each project in a folder of its own there and reaches nothing outside it.

The tray icon of a machine is green while it hears the hub and red when it has not for three minutes; it has no page to open. `even-keel status` prints the hub, the folder of projects and the last contact.

In the chain and the lists each machine has an icon: a circle for the hub, a rounded square for a machine, filled with its colour, with its system's sign inside and a thin frame when Even Keel runs there in Docker.

### After it joins

The window waits for the machine; you can close it, and when the machine joins a notice opens it again. It then shows:

1. **What it found there** — Node.js, git with its user name and e-mail, the agents' CLIs — and what fails without a missing one. A machine without a git name or e-mail takes no task: set them with **Set name and e-mail** on its page, filled with the hub's own.
2. **The hub's projects to connect it to.** For each one ticked, its folder there: by default the project's folder name in the machine's folder of projects; **another folder…** takes a full path. Under it the window says what is there: a free folder gets a clone of the project, a folder with its clone is taken as it is, and a folder holding something else says what to do and keeps **Connect** off. **Connect** checks each folder in turn in a progress window (a git repository with one of the hub's remotes, the branch, the right to push); a failed check says what to fix and offers **Retry**. The same folder field is in **Connect a machine** on a project's **Machines** tab.
3. **The hub's accounts to sign in to there**, with **Sign in on this machine** ([Accounts on a machine](#accounts-on-a-machine)).

### Machines in Docker or from a clone

**Docker.** The window's **Docker** switch gives the same machine as a container: the line for the Compose folder's `.env`, the join and the start. Each of the four ways — hub and machines on hosts, either of them in Docker, both in Docker — and how machines on several hosts are updated are in [Installing with Docker, Machines](docker.md#machines).

**A clone.** The window's command names the hub's version, and a hub that runs from a clone between releases has the last release's version, which has no machines yet. Make such a hub's machine from a clone at the hub's commit instead, with the connection string:

```sh
git clone https://github.com/NamerekT/even-keel.git && cd even-keel
git checkout --detach <the hub's commit>
npm ci
service/install.sh --machine '<connection string>' --root ~/projects
```

The script builds the machine without the page (`npm run build:machine`), joins and installs the user service. On Windows, build with `npm run build:machine`, then run `node dist/src/cli.js install --machine '<connection string>'` for the start at sign-in, or `service\install.ps1 -Machine '<connection string>' -Projects <folder>` for the Windows service, from PowerShell 7 as administrator. Such a machine follows the hub's commit by itself.

## Updating machines

A machine runs the hub's version. A machine of another version gets no new tasks: it finishes the ones it has, and its page on the hub says which version to install and gives the command to run on the machine, `even-keel update <the hub's version>`. Update the hub first, then each machine.

When the link between the two versions changed and the hub refuses the machine outright, the machine updates itself — to the hub's version if it is a global npm install, to the hub's commit if it runs from a git checkout — and comes back. When it cannot, its page on the hub says why: local changes in its checkout, no service, or a failed update (not retried until the hub moves to another version).

## Projects and tasks on machines

**A new project on several machines.** Once the hub has a machine, the wizard's **Repository** step lists the machines in place of the field **Folder**:

- Tick each machine the project runs on. A ticked row opens its folder there — the machine's folder of projects and a name, or **another folder…** with a full path — and says whether the folder is free (the project is cloned there), already holds a clone of this repository (it is taken as it is) or holds something else (with what to do).
- A clone, made or taken, is put on the project's main branch: a clean one standing elsewhere is switched, one with uncommitted changes is refused until you commit them or put them aside.
- The hub can be unticked too: the project then does not run on it.
- A new folder or a repository without a remote stays on the hub only, since the other machines take a project only through its remote. A machine off the link is connected later from the project's settings, **Machines**.
- A machine where no agent is signed in is connected all the same, with **Sign in on …**: tasks do not go there until an agent signs in.

Creating the project connects each ticked machine in turn in the progress window; one machine failing leaves the others connected, and the window names it with its fix above **Retry**.

**A task only on some machines.** A task that must run on one computer — a check that needs something only that computer has — can be pinned: on the task card, **Runs on** has **Machines** while the project's pool has more than one machine; tick the ones it may run on, or **any machine of the pool**. A session that files tasks through the tasks server can pin one by machine name. Other machines pass the task over and take the next ones; while its machines are busy or off the link the task waits, with "waits for …" on its row, and the chain goes on with the rest. A pin to a machine taken out of the pool says so on the row, with a button to the card. A task already running stays where it is: to move it, use **Reassign**.

**A machine that goes away** — switched off, off the network, or revoked — keeps the tasks it was running: the chain does not hand them to another machine by itself, since the machine may come back with its work. Such a task's row in the chain shows **Reassign** once its branch is on the remote: another machine then goes on with it from the pushed branch and the last handoff note, and the machine that left does not take it back. Only the commits of a turn still running when the machine went away are lost: the branch is pushed at the end of every turn.

**One machine per folder.** A machine, the hub's own included, marks each project folder it serves with the file `.git/even-keel-machine`. Another machine or installation that reaches the same repository — over a network share, from a container, from a second installation — is refused it, and its chain pauses with "already served by machine …". Revoking a machine takes its marks off. When the marking machine is gone for good, press **Take the folder over** under the chain's pause: the page names the machine that loses the folder and asks to confirm, then takes the folder and resumes the chain. A machine that is still running stops working in that folder. For a machine elsewhere, open its page from the machines panel: each folder another machine holds there is a band "Another machine holds the project's folder" with the same **Take the folder over** and the same confirmation.

## Commands of its own

A machine may run a project differently. In the project's settings pick the machine and open its settings tab: **The machine's own commands** takes

- its commands before the start;
- its check commands;
- its commands after a green `main`;
- for each stdio server of the project's packages, another command or arguments — say, another path to a program or a folder.

A field left blank is the project's, shown in it in grey. **Connect a machine** can copy them from another machine of the project. Connecting refuses a machine where a server's command is not found. The tab **Machines** shows under each machine what it runs.

After a green `main`, every machine of the project with commands after it brings its own clone's `main` up to the green commit and runs them there; a machine that was off then runs them once when it is back, for the last green commit only. The hub's own checkout is brought up to the green commit too, when another machine pushed it. A machine where the project's commands do not belong — the hub's deploy, say — turns on **Run no commands after a green main on this machine** under its lists; a blank list still runs the project's.

## Accounts on a machine

A machine runs sessions on its own sign-ins, never the hub's. The account stays on the machine: the hub keeps neither its token nor its credentials file.

A machine takes no task of an agent it has no account for, nor one whose project's account is not signed in there: it runs the same account in any folder of its own, a [long token](accounts.md#claude-a-full-sign-in-or-a-long-token) of it included, while the hub or another machine of the pool runs the task. When no machine of the pool has that account, the project pauses with "The project's account … is not signed in on machine …" and **Add account** with that machine picked.

**From the hub's accounts page.** Under each subscription account, a line names every connected machine where that account is not signed in, with **Sign in**: the sign-in runs on that machine, its link opens in your browser, and the code from the sign-in page goes into the window on the hub's page, which hands it to the machine. The window names the agent, whose sign-in it is (Claude, ChatGPT, GitHub…), the machine's folder it signs in and whether the chain's tasks there take that account. A machine without the agent's CLI says so instead of offering the button.

**One machine's accounts.** Pick a machine in the machines panel, and the header's account block and the accounts page show that machine alone, in the same table and drawer as the hub's:

- its accounts with the limits it read, who uses each and its sessions there;
- a signed-out one marked "not signed in" with **Sign in**. A folder that runs on an API key or a long token says so instead, since a browser sign-in would put a subscription into it; a key's folder gets **Enter key** for a new key; one that tells neither asks first whether it is a subscription or a key;
- at the end of each agent, every hub account not signed in there, marked "signed in on the hub, not here", with **Sign in** too. When the machine's own Claude Code or Codex sign-in (`~/.claude`, `$CODEX_HOME`) already holds that account, the row says "signed in here, not added" instead, and **Use it** adds that sign-in with no new one; the machine reads it every 10 minutes.

Pointing at the header's block shows the task's, the project's and the shared account as that machine takes them. **Add account** at the top adds an account to that machine only: choose the agent (one whose CLI the machine lacks is greyed with a tip), then sign in in the same window, or choose **API key** and paste an Anthropic, OpenAI or OpenRouter key: the machine checks it and keeps it in its own account folder, not on the hub. Both are greyed while the machine is off the link.

Once the hub has a machine, **Add account** anywhere starts with **Where it signs in**: the hub or one machine on the link. Opened from a machine's accounts, that machine is picked; elsewhere, the hub. On a machine, Claude Code offers the hub's choice of **Full sign-in** or **Long token**.

### A long token on a machine

A machine left alone for weeks is best on a [long token](accounts.md#claude-a-full-sign-in-or-a-long-token). Under **Long token** of a machine's **Add account**:

- **The same token as …** comes first for each hub account already on a long token: one press hands the machine the token the hub keeps, with nothing to issue or paste;
- **A new token** has the `claude setup-token` command, the field and a pick of the hub's account the token belongs to.

The machine checks the token and keeps it in its own account folder. The hub then gives the machine the limits it reads from its own full sign-in of that account, and the account's **Machines** column shows the machine's label with a key. So one full sign-in of the account, on the hub, is enough for the limits of every machine on a token; the machines on a token still have no Remote Control, so answer their sessions from the page's chat or in the tracker.

While no full sign-in of the account is left anywhere, the account says "limits from sessions only" (on the hub's row, or in the tip of the machine's label). Sign in to it fully on the hub again: **Sign in fully** on a long-token row, or the account's own **Sign in** when its folder on the hub was signed out.

## Your Claude Code configuration on every machine

Your skills, agents, commands, output styles and hooks, your `CLAUDE.md` and your `settings.json` are the same on the hub and every machine. Each computer keeps its own `env`, `hooks`, `statusLine` and `extraKnownMarketplaces` of `settings.json`, since those name variables and paths of that computer.

They live in `~/.claude-config`, which `~/.claude` and the account folders link to, and Even Keel keeps it in sync over the link: edit them on any computer, and the hub gets the change within a minute and the other machines within ten, or as soon as they are back online.

- A skill, agent, command or output style is seen by the next session that looks for it.
- Hooks, `settings.json` and `CLAUDE.md` take effect from the next session's start; an account folder takes `settings.json` and `CLAUDE.md` at its next launch.
- When two computers changed the same lines of a text before they met, the newer version is kept and the next Claude session that reads the file is asked to merge the other one in.
- A hook or `settings.json` changed on both keeps the newer version for now, and the hub's page shows a yellow band at the top with the file, the computer where the two met and both versions (point at one to read it whole): press **Keep this** or **Take the other**, and every computer gets your choice.

## Behind a proxy

The link is one long HTTPS stream from the hub, and the connection string carries the fingerprint of the hub's own self-signed certificate: the machine talks only to a hub that shows exactly that certificate.

- **A port forward or a pass-through proxy** (a router's port forward, a TCP forward, nginx `stream`) works as it is.
- **A proxy that ends TLS itself** — a reverse proxy, a Cloudflare tunnel — shows the machine its own certificate, which a string with a fingerprint refuses. For such a hub turn on **Behind a proxy with a public certificate** under the address in the **+ Machine** window (the window remembers it in this browser). The string then carries no fingerprint, the machine checks the proxy's certificate as any HTTPS site's (it must be of a public authority, such as Let's Encrypt or Cloudflare's own), and an address without a port means 443.
- **The proxy's way to the hub.** The hub still listens for machines over HTTPS with its self-signed certificate, so the proxy forwards to `https://<hub>:4749` without checking that certificate: nginx's `proxy_pass https://…` does so by default, a Cloudflare tunnel needs `noTLSVerify: true` for that service, Caddy `tls_insecure_skip_verify`.
- **No buffering.** A proxy on the way must not hold the stream back and must keep it open: for nginx `proxy_buffering off; proxy_read_timeout 1h;`. An idle timeout such as a Cloudflare tunnel's 100 seconds needs nothing: the hub sends a pulse more often. When a proxy holds the stream, the connection opens, nothing comes over it and the machine reconnects again and again; its log then says "a proxy on the way seems to hold the stream back". Turn that proxy's buffering off for the hub's address for machines, or take the proxy off the way.
- **An antivirus or a corporate proxy that inspects HTTPS** shows a certificate of its own authority, which a string with a fingerprint refuses, as it should.
