<!--
Material for a post, not a post yet: the facts and the line of the story, gathered 2026-10-27 while
talking through Docker (BTN-96) and several machines (BTN-137). Not published from here.

Where it may go: Patreon "Behind the build" (a design decision, with the reasoning), then a shorter
r/ClaudeCode version.

Before writing it up:
- Sortie moves fast (a release every 3–4 days): check its Docker guide, examples/docker/ and
  docs/architecture/27-appendix-a-ssh-worker-extension.md again on the day;
- none of the hub is built yet: say so, or wait until step 2 of BTN-137 (a hub with one machine) has landed
  and tell how the paper plan held up — that is the better post;
- no Tally numbers yet; a candidate: how many chain sessions outlived a service restart or an update
  mid-turn (the case SSH workers could not survive);
- no names of Sortie's author, only the project.
-->

# Why Even Keel will not send its agents over SSH

Working titles:
- "Same problem, opposite answers: spreading coding agents over several machines"
- "Our agent is not a stream in stdout"

## The hook

Two open-source orchestrators for coding agents, the same question: how do agents run on more than one
machine, or in a container? Sortie answered it with SSH workers and a Docker image in a few files. Even Keel
is going the long way: a hub and machines that each run their own service. The simpler way was right there;
this is why we did not take it.

## How Sortie does it (checked 2026-10-27)

- The agent is a child process of the orchestrator, spoken to over stdio.
- Docker: a distroless image with the Go binary, plus one example Dockerfile per agent (`node:24-slim`, the CLI
  from npm, a non-root user, since `--dangerously-skip-permissions` refuses root). The agent runs in the same
  container. Keys come in as `-e ANTHROPIC_API_KEY` and the like; the docs say nothing of a subscription login.
  Workspaces are a mounted folder that hooks fill, usually with `git clone`.
- Kubernetes: one replica, `Recreate`, a PVC for the SQLite database.
- Other machines: SSH workers. The agent's stdio goes over SSH; Sortie's tool server reaches the remote agent
  through a reverse port forward on the same connection, with a bearer issued to that session.
- A side find: Codex's bubblewrap sandbox needs user namespaces, which Ubuntu 24.04 restricts through
  AppArmor; Sortie ships a script to lift it on runners.

For a stateless worker this is clean: the process just starts somewhere else.

## Why it does not fit Even Keel

Even Keel's sessions are not streams. They are the `claude --bg` daemon's jobs, and they outlive the service:
an update or a restart mid-turn leaves them running, and the new service picks them up. Everything else is
built on the machine's own files:

- a session is alive when the CLI's `sessions/<pid>.json` has a live pid;
- transcripts are local, and Tally reads them;
- each machine signs in to the subscription itself, and Remote Control answers from the phone;
- the task's worktree is cut from the user's own checkout, not a fresh clone.

Pulling that through SSH means rewriting half the service for three operating systems, and losing what makes
it survive the night.

## What we chose instead (BTN-137, on paper)

- Two roles of one package: a hub that coordinates (order, the `main` lock, CI verdicts, the page, the
  database) and machines that execute (accounts and limits, repositories, worktrees, sessions).
- A machine is its own service and dials out to the hub: HTTPS with SSE, so it needs no open port behind NAT.
- Being cut off is the normal mode: numbered commands kept until confirmed, events queued on the machine,
  a snapshot after reconnecting; a machine without the hub keeps its sessions working.
- Tasks are pulled, not pushed: a machine with a free place asks for the next ready one.
- A container is just one more machine. Docker stops being a special case.

## What fell out of thinking it through

Small things nobody would see in the first sketch:

- **The hostname check has a hole.** "Refuse a second install of the same folder on the same host" lets a
  container with the host's folder mounted through: it reports its own hostname and its own path. The fix is a
  marker with the machine's id inside the folder's `.git`.
- **A limit belongs to the account, but the machine owns the account.** Two machines on one account burn one
  window; and handing the next task to a machine with another account when the first is spent looks a lot like
  switching accounts on a limit, which Even Keel does not do.
- **A red `main` holds a branch, not a project**: everyone working on that branch stops, on any machine;
  a release clone on another branch of the same remote does not.
- **A version mismatch means "no new tasks", not "disconnect"**: cutting a machine off would orphan the
  sessions it is still finishing.
- **No message broker, no identity service.** The queue with numbers and acknowledgements is already in the
  design, and a broker would not remove the local store a machine needs while it is offline anyway. People sign
  in only at the hub, with signed tokens, or an identity from a proxy in front of it.

## The honest end

It is a plan on paper with open questions in it. The first step is a hub with one machine and no change in
behaviour, and that is where the paper meets the code.
