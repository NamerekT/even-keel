# Setting up Even Keel

The [README](../../README.md) has the quick start. This page covers [installing](#installing) — what it needs, from npm or from a clone, a look at the page on fake data — and [the first start](#the-first-start), the setup's steps. What comes after it, from adding a project to uninstalling, is in the [guide's index](README.md#start-here), in the order a new installation meets it. Every variable and key is in the [reference](reference.md).

## Installing

For a server or NAS with Docker, see [Installing with Docker](docker.md).

### What it needs

- **Node.js 24** or newer ([nodejs.org](https://nodejs.org/en/download); on Linux nvm needs no `sudo`). On macOS the nodejs.org installer leaves npm's global folder to root: move it into your home first, with the [commands `npx even-keel` prints](service.md#npms-global-folder-on-macos-and-linux), and never use `sudo`. On Windows the MSI installer of Node can sit on "Preparing to install…" for over 10 minutes: wait it out.
- **An agent and an account of it:** [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), [Codex](https://github.com/openai/codex), [OpenCode](https://opencode.ai) (preview) or [GitHub Copilot CLI](https://github.com/github/copilot-cli) (preview), on a subscription or an API key; OpenCode also runs its free models. The setup can download the CLI for you.
- **git**, recommended ([git-scm.com](https://git-scm.com/downloads)), with your name and e-mail set (`git config --global user.name` and `user.email`): sessions commit and merge under that name, and [the Git step](#the-git-step) of the setup sets both. Without git a project is a plain folder: [A project without git](chain.md#a-project-without-git).
- **A tracker**, optional: a Huly workspace, GitHub, GitLab (GitLab.com or your own server) or Forgejo (Forgejo, Gitea or Codeberg) projects with Issues, a Linear workspace or a Jira Cloud site. Without one the tasks live in the [built-in tracker](tracker-builtin.md#no-account-the-built-in-tracker).
- **Windows, Linux or macOS.** Windows is where it runs every day; Linux and macOS (Apple silicon) were checked end to end.

### From npm

The README's quick start installs Even Keel with `npx even-keel` (`npx.cmd even-keel` on Windows, [why](service.md#windows-powershell)), which also sets it up as a service: the details are in [Installed with npm](service.md#installed-with-npm). To run it in a terminal instead of as a service:

```sh
npm install --global even-keel
even-keel
```

### From a clone

The other way is a clone of the repository. It keeps its data and logs in its own folder and runs its sources:

```sh
git clone https://github.com/NamerekT/even-keel.git
cd even-keel
npm install
npm run build
npm start
```

Then open `http://localhost:4747`, as in the README's quick start. To set the clone up as a service: [A clone as a service](service.md#a-clone-as-a-service).

Do not run `npx even-keel` inside a clone: npx sees the clone's own `package.json`, takes the package for installed and fails with "'even-keel' is not recognized" because `node_modules/.bin` is empty.

### A look first, on fake data

In a clone, after `npm install`, the page can run with a made-up chain, no tracker and no sessions; it opens at `http://localhost:5173`. An npm install has no such command.

```sh
npm run dev:fake
```

## The first start

The projects and the settings live in Even Keel's database and are edited on the page; there is no file to create. The first start walks a short setup, each choice saved as you make it and changed later in **Settings**:

- the languages of the page and of the session prompts;
- [phone access](#phone-access) (or later) — the phone comes in by an invitation;
- [git](#the-git-step) — whether it is installed, and the name and e-mail commits are made as;
- [the agent](#the-agent-step) all projects run on by default, its account and which version of its CLI sessions run on;
- a tracker profile (or later);
- whether Even Keel may ask GitHub twice a day for a new release — nothing is asked until you answer;
- and the [statistics](stats.md#statistics).

A step gets its tick only once it has its answer, and a step you skip is not offered again.

If you leave the setup unfinished, **Add project** (or **Connect your own** in the demo's band) first asks whether to finish it: **Set up** goes back to the step it stopped at, **Not now** leaves you where you are. On the welcome page with no project yet, the card **Set up Even Keel and connect a project** takes you back to that step at once.

### Phone access

The second step lets your phone in without typing a key: **Invite the phone** opens the invitation's QR and link ([Signing in on a new device](remote.md#signing-in-on-a-new-device)). The step gets its tick once the first device is in. The phone reaches the page by the name of a proxy on this machine, such as a Tailscale Service ([Reaching the page from another machine](remote.md#reaching-the-page-from-another-machine)). No proxy yet? Press **Skip for now**: the same invitation is under Settings → **Sign-in and devices**.

### The Git step

Git is needed only for projects that live in a repository. The step first asks **Use git?**:

- **Yes** (picked in advance where git is installed) goes on to the check of git and the name and e-mail for commits, written into git's global config of the user Even Keel runs as. Even Keel never installs git: it shows the command that does.
- **No** is for [projects without git](chain.md#a-project-without-git) and goes on at once.

The answer is what the project wizard starts on for a new project, each project still picking its own; change it later on the Git step or in Settings → Chain → **New projects**.

After installing git, press **Check again**:

- **Windows:** Even Keel reads the system and user `PATH` anew and finds git without a restart; only when it still does not, the step says how to restart Even Keel.
- **macOS:** the step offers `xcode-select --install`, even when Homebrew is installed. It installs only the Command Line Tools; Xcode from the App Store is not needed. If full Xcode is installed but its license has not been accepted, git fails with a license error: run `sudo xcodebuild -license accept`.

### The Agent step

The step has three parts:

- **the agent cards**, each saying whether its CLI is installed and on which version;
- **Which version to run** for the chosen agent: **Yours** (the CLI installed on the machine) or **Checked** (Even Keel's own copy of the version it was checked against, downloaded with your consent — about 340 MB for Claude Code). In Docker, or where npm cannot install the CLI globally, there is also **Latest**, Even Keel's copy of the newest release ([CLI copies](agents.md#cli-copies));
- **its accounts** as a table, the one sessions run on ticked, **+ Add** in the heading.

Without your CLI, Yours shows the command that installs it with **Install** and **Check again**; choosing Checked asks before downloading. What happens when a download fails is in [CLI copies](agents.md#cli-copies).

**Next** waits until the agent has something to run on (your CLI, or the copy, even still downloading) and an account.

### Accounts

Installing a CLI or signing in to it does not add an Even Keel account: use **Add account** on the Agent step ([Adding an account](accounts.md#adding-an-account); a cloud's credentials, in [Claude on a cloud](accounts.md#claude-on-a-cloud)).

Even Keel moves your Claude Code skills, agents, commands, hooks and output styles into `~/.claude-config` and each project's memory into `~/.claude-memory/<project>`, leaving links in their old places, so Claude Code goes on finding them, and every account folder and machine shares them ([your Claude Code configuration](hub-machine.md#your-claude-code-configuration-on-every-machine)). [Uninstall](uninstall.md#in-your-claude-code-config) says how to put them back.

### The demo

With no project yet, the home page offers two cards: **Watch the demo** or **Connect your project** (**Set up Even Keel and connect a project** while the setup is not finished).

The demo takes about two minutes and needs nothing installed: Even Keel makes a small project folder in its state folder and a project `DEMO` on the built-in tracker, and its chain goes through three tasks while you watch — one waits for another, and one asks you a question in the session's chat.

The folder follows the same rule as a new project ([the Git step](#the-git-step)): a git repository, where each task is committed and merged, unless you answered **No** or git does not start on the machine — then it is a [project without git](chain.md#a-project-without-git), whose tasks write their files in the folder and close by their answer. Each **Run again** picks the mode anew.

The agent is a script, so no account is used and nothing is spent; the demo stays out of the home page's launches chart and the statistics.

A band over the demo's project leads to your own project with **Connect your own**; when the demo is over, its card offers to run it again or remove it. It is never removed by itself: the project wizard's **Remove the demo** (on by default) removes it once your project is added, and **Remove** in the band's **⋯** stops it and deletes its project, tasks and folder at any moment.
