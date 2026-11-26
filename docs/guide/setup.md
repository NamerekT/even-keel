# Setting up Even Keel

The [README](../../README.md) has the quick start. This page is the rest, in the order a new installation meets it: installing, the first start, a project, its tracker, the page on other devices, the service, updates and removal. Every variable and key is in the [reference](reference.md).

1. [Installing](#installing) — what it needs, from npm or from a clone, and a look at the page on fake data
2. [The first start](#the-first-start) — the setup's steps: git, the agent and its account, the demo
3. [Projects](projects.md#projects) — the wizard, the repository's folder or address, what a project needs
4. [Trackers and plugins](tracker-builtin.md#trackers-and-plugins) — the built-in tracker, a profile per tracker, packages for sessions, CI and token permissions
5. [The page](remote.md#the-page) — answering from the phone, reaching the page from another machine
6. [As a service](service.md#as-a-service) — npm, a clone, Windows, Linux and macOS; another computer joins as [a machine of a hub](hub-machine.md#a-machine-of-a-hub-preview)
7. [Updating](updating.md#updating) — from the page or by hand, plugins, stored state, going back
8. [Uninstall](uninstall.md#uninstall) — and what stays on the machine
9. [The CLIs it depends on](clis.md#the-clis-it-depends-on) — what Even Keel relies on in each agent's CLI, and the checked versions

## Installing

For a server or NAS with Docker, see [Installing with Docker](docker.md).

The README's quick start installs Even Keel with `npx even-keel` (`npx.cmd even-keel` on Windows, [why](service.md#windows-powershell)), which also sets it up as a service: the details are in [Installed with npm](service.md#installed-with-npm). To run it in a terminal instead of as a service:

```sh
npm install --global even-keel
even-keel
```

The other way is a clone of the repository.

### What it needs

- **Node.js 24** or newer ([nodejs.org](https://nodejs.org/en/download); on Linux nvm needs no `sudo`). On macOS the nodejs.org installer leaves npm's global folder to root: move it into your home first, with the [commands `npx even-keel` prints](service.md#npms-global-folder-on-macos-and-linux), and never use `sudo`. On Windows the MSI installer of Node can sit on "Preparing to install…" for over 10 minutes: wait it out.
- **An agent and an account of it:** [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), [Codex](https://github.com/openai/codex), [OpenCode](https://opencode.ai) (preview) or [GitHub Copilot CLI](https://github.com/github/copilot-cli) (preview), on a subscription or an API key; OpenCode also runs its free models. The setup can download the CLI for you.
- **git**, recommended ([git-scm.com](https://git-scm.com/downloads)), with your name and e-mail set (`git config --global user.name` and `user.email`): sessions commit and merge under that name, and [the Git step](#the-git-step) of the setup sets both. Without git a project is a plain folder: [A project without git](chain.md#a-project-without-git).
- **A tracker**, optional: a Huly workspace, GitHub, GitLab (GitLab.com or your own server) or Forgejo (Forgejo, Gitea or Codeberg) projects with Issues, a Linear workspace or a Jira Cloud site. Without one the tasks live in the [built-in tracker](tracker-builtin.md#no-account-the-built-in-tracker).
- **Windows, Linux or macOS.** Windows is where it runs every day; Linux and macOS (Apple silicon) were checked end to end.

### From a clone

A clone keeps its data and logs in its own folder and runs its sources:

```sh
git clone https://github.com/NamerekT/even-keel.git
cd even-keel
npm install
npm run build
npm start
```

Then open `http://localhost:4747`, as in the README's quick start. To set the clone up as a service: [below](service.md#a-clone-as-a-service).

Do not run `npx even-keel` inside a clone: npx sees the clone's own `package.json`, takes the package for installed and fails with "'even-keel' is not recognized" because `node_modules/.bin` is empty.

### A look first, on fake data

The page with a made-up chain, no tracker and no sessions, after `npm install`; it opens at `http://localhost:5173`:

```sh
npm run dev:fake
```

## The first start

The projects and the settings live in Even Keel's database and are edited on the page; there is no file to create. The first start walks a short setup, each choice saved as you make it and changed later in **Settings**:

- the languages of the page and of the session prompts;
- [phone access](#phone-access) (or later) — the phone comes in by an invitation, with no owner key;
- git — whether it is installed (Even Keel never installs it and shows the command that does) and the name and e-mail commits are made as, written into git's global config of the user Even Keel runs as;
- the agent all projects run on by default, its account (sign in, or add one in a dialog over the step) and, for each provider, whether sessions run on the CLI version Even Keel was checked on (downloaded with your consent, about 340 MB for Claude Code) or on the one installed — without a CLI, the step installs it at a press of a button or takes Even Keel's copy;
- a tracker profile (or later);
- whether Even Keel may ask GitHub twice a day for a new release — nothing is asked until you answer;
- and the [statistics](stats.md#statistics).

A step is checked on the line only once it has its answer, and a step you skip is not offered again.

If you leave the setup unfinished, **Add project** (or **Connect your own** in the demo) first asks whether to finish it: **Set up** goes back to the step it stopped at, **Not now** leaves you where you are. On the welcome page with no project yet, the card **Set up Even Keel and connect a project** takes you back to that step at once.

### Phone access

The second step lets your phone in without looking for the owner key in `.env`. Press **Invite the phone**: the window shows a QR and a link. Scan the QR with the phone, check that both screens show the same two digits and press **Let in**; the phone signs in and offers to add a passkey. The step is checked once the first device is in, and from then the page asks every browser that comes by the proxy's name to sign in ([Signing in on a new device](remote.md#signing-in-on-a-new-device)).

The phone reaches the page by the name of a proxy on this machine, such as a Tailscale Service ([Reaching the page from another machine](remote.md#reaching-the-page-from-another-machine)), never by `localhost`. Opened by `localhost`, the window's link goes to the address the page was last opened by from outside; when there was none yet, the window asks for it — the proxy's address with its port, such as `https://my-pc.example.ts.net:8443` ([Signing in on a new device](remote.md#signing-in-on-a-new-device)). No proxy yet? Press **Skip for now**: the same invitation is under Settings → **Sign-in and devices**.

### The Git step

Git is needed only for projects that live in a repository.

The setup's **Git** step first asks **Use git?**: **Yes** goes on to the check of git and the name and e-mail for commits; **No** is for [projects without git](chain.md#a-project-without-git) and goes on at once, asking nothing of git.

Where git is already installed, **Yes** is picked in advance.

The answer is what the project wizard starts on for a new project, each project still picking its own; change it later on the Git step or in Settings → Chain → **New projects**.

On Windows, after installing git with its installer, press **Check again**: Even Keel reads the system and user `PATH` anew and finds git without a restart. Only when it still does not, the step says how to restart Even Keel.

On macOS, the setup's **Git** step always offers `xcode-select --install`, even when Homebrew is installed.

It installs only Command Line Tools; Xcode from the App Store is not needed. After installation, press **Check again**.

If full Xcode is already installed but its license has not been accepted, run `sudo xcodebuild -license accept`.

The macOS git stub reporting `xcrun: error: invalid active developer path` is treated as missing git; a license error remains a git command error with its original message.

### The Agent step

The setup's **Agent** step has three parts: the agent cards, each saying only whether its CLI is installed and on which version; "Which version to run" for the chosen agent, **Yours** or **Checked** or, where the CLI cannot be installed, **Latest**; and its accounts as a table, the one sessions run on checked, **+ Add** in the heading.

Without your CLI, Yours shows the command that installs it, **Install** and **Check again**. **Install** runs that command itself, as the user Even Keel runs as, and shows its output under it; once it ends, Even Keel looks for the CLI again. You can run the command in a terminal yourself instead and press **Check again**.

Where you cannot install the CLI yourself (in Docker, or when npm's global folder is not writable), there is no command. Instead, a third choice, **Latest**, runs Even Keel's own copy of the agent's newest release, which it keeps up to date by itself ([Agents](agents.md#cli-copies)).

Choosing **Checked** there or in Settings → Providers and models asks before downloading: the dialog shows the version and approximate size, and Cancel keeps Yours.

Blue bands under the header and in the agent's block show downloaded bytes while it runs; in the setup, adding an account opens by itself once the download ends, since the sign-in goes through the CLI.

**Next** waits until the agent has something to run on (your CLI, or the copy, even still downloading) and an account.

A provider already on Checked whose copy is missing asks the same when you select it or add its account; closing the dialog keeps the choice and leaves the chain waiting.

No startup, sign-in or version check downloads a copy by itself, with one exception: a provider on Checked whose copy you have downloaded before fetches each newer checked version without asking again, and one on Latest each newer release.

If downloading fails, **CLI version** switches to **Yours** for that provider and offers **Try downloading again**.

An installed CLI can then run sessions; without one, the block shows an installation command, **Install**, **Check again**, and Checked to choose again.

Even Keel installs a CLI itself only when you press **Install**, with the agent's official installer; without the press, never.

Old copies are removed, retrying folders still held by a process at startup and each version check.

### Accounts

Installing a CLI or signing into it does not add an Even Keel account.

Use **Add account** on the setup's Agent step, the Accounts page or the project wizard.

If a global Claude Code or Codex folder is already signed in, choose **Use this sign-in** to add it or **Sign in with another account** to keep a separate folder.

Without an existing sign-in the normal choices open directly.

The first account you add for a provider becomes its shared account.

Claude Code on Amazon Bedrock needs no sign-in, only AWS credentials the user Even Keel runs as can read: with the Windows service under another user, sign in to AWS (`aws sso login`, `aws configure`) as that user, or give the keys in the dialog ([Bedrock accounts](accounts.md#amazon-bedrock)).

Google Vertex AI is the same: run `gcloud auth application-default login` as that user, or give a service account key file the user can read ([Vertex accounts](accounts.md#google-vertex-ai)).

Microsoft Foundry's Entra ID way needs `az login` as that user, or give the resource's API key ([Foundry accounts](accounts.md#microsoft-foundry)).

### The demo

With no project yet, the home page offers two cards: **Watch the demo** or **Connect your project** (**Set up Even Keel and connect a project** while the setup is not finished).

The demo takes about two minutes and needs nothing installed: Even Keel makes a small project folder in its state folder and a project `DEMO` on the built-in tracker, and its chain goes through three tasks while you watch — one waits for another, and one asks you a question in the session's chat.

The folder follows the same rule as a new project ([the Git step](#the-git-step)): a git repository, where each task is committed and merged, unless you answered **No** or git does not start on the machine — then it is a [project without git](chain.md#a-project-without-git), whose tasks write their files in the folder and close by their answer. Each **Run again** picks the mode anew.

The agent is a script, so no account is used and nothing is spent; the demo stays out of the launch chart and the statistics.

A band over the demo's project leads to your own project; when the demo is over, its card offers to run it again or remove it.

It is never removed by itself: the project wizard's **Remove the demo** (on by default) removes it once your project is added, and **Remove** in the band's **⋯** stops it and deletes its project, tasks and folder at any moment.
