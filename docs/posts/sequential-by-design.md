<!--
Draft of the release post (BTN-69). Not published from here: the author posts it by hand.

Before posting:
- the repository must be public: the link below points at github.com/NamerekT/even-keel,
  and the images load from its `main` (assets/screens/), so they show only once a release carries them there;
  where a site takes no image links (Show HN), upload the files from assets/screens/ or drop them;
- re-run docs/posts/sequential-by-design.sql if the period is moved; every number below comes from it;
- the comparison table is as of 2026-10-19 — check the rivals' READMEs again on the day;
- "MIT licensed" in the last section follows LICENSE: change it if the license question (BTN-241) ends otherwise.

Where to post, in this order:
1. Show HN — title "Show HN: Even Keel – run your issue tracker's backlog through Claude Code, one task at a time";
   the first comment is the "Why sequential" and "The numbers" sections, shortened.
2. r/ClaudeCode — the whole post.
3. r/ClaudeAI — the whole post, flair "Built with Claude".
4. The Claude Code Discord, the channel for projects built with it — two lines and the link.
5. Pull requests to awesome lists: hesreallyhim/awesome-claude-code (section of orchestrators / tooling),
   and any awesome-codex list once Codex leaves preview.

A ready answer to "several accounts = getting round the limits / the terms?" (keep it in line with the README's "Before you run it"):
  No. A project runs on one account per provider, and when its limit is spent the chain waits for the reset;
  it never switches to another account to keep going. Several accounts exist so that separate projects can
  spend separate subscriptions — a side project does not eat the main one's window — and for API keys.
  Sessions run through the unmodified `claude` and `codex` CLIs on accounts you sign in with yourself, under
  Anthropic's and OpenAI's terms. OpenAI's terms rule out getting round its limits, so Even Keel refuses a
  second Codex account on the free plan. It does not share, pool or resell access.
-->

# Ten agents at once is the wrong unit: running a backlog one task at a time on a Claude subscription

**TL;DR.** Even Keel is an open-source dispatcher that runs a tracker's backlog through Claude Code one task at a time, in the order of the `blocks` links, and keeps going through usage limits, long contexts and questions while you are away. On a subscription the weekly window is the budget, and width only empties it sooner. In three weeks on my own projects the chain closed 421 of 428 tasks at a median 1.76 % of a weekly window each, and its longest run went 16.4 hours overnight.

OpenAI's Symphony spec sets `max_concurrent_agents` to 10 by default. Most orchestrators for coding agents sell the same thing: width. Ten agents, ten worktrees, ten tasks at once.

I went the other way. [Even Keel](https://github.com/NamerekT/even-keel) takes the open tasks of a project from the tracker (Huly, GitHub Issues or Linear), orders them by their `blocks` links and runs them through Claude Code **one at a time**: a session on the first task, and when its branch lands in `main`, cleanup and the next. It runs as a service on my own machine, on my own subscription, through the unmodified `claude` CLI.

![A task goes to Done, its worktree is cleaned up and the next task's session starts](https://raw.githubusercontent.com/NamerekT/even-keel/main/assets/screens/chain.gif)

This post is about why, with numbers from three weeks of running it.

## Why sequential

On a subscription the constraint is not how many agents you can start. It is the weekly usage window. Ten agents don't make the window bigger; they empty it sooner. So the question is not "how wide" but "what does the window buy, and does the work keep going when I'm not there".

Three more reasons, which I believed before I had numbers:

- **Backlog tasks are connected.** An agent working on task B in parallel guesses what task A, not yet done, will look like. The agent that runs B after A reads A's merged code.
- **The bottleneck is my attention.** Questions, reviews and merges are mine. Ten agents produce ten queues of them at once.
- **A worktree isolates the work, not the result.** Conflicts, especially the semantic ones git doesn't see, move to merge time.

So Even Keel bets on time instead of width: the agent keeps working while I'm away, and the chain survives what usually stops it:

- **A spent usage limit.** It waits for the reset and resumes the same session while its prompt cache is warm.

  ![The session hit the usage limit; the panel says it goes on after the reset with the cache still warm](https://raw.githubusercontent.com/NamerekT/even-keel/main/assets/screens/limit.png)

- **A context that has grown too large.** The session writes a handoff note and a fresh session continues in the same worktree.
- **A question.** It waits for me on a web page, in the tracker or on my phone, and only that task waits.

  ![The page's chat with a session's question and its options](https://raw.githubusercontent.com/NamerekT/even-keel/main/assets/screens/question.png)

## The numbers

Even Keel ships with a stats collector, Tally, that reads every session transcript into an embedded Postgres. That is where these numbers come from. The period is 2026-09-28 to 2026-10-18 — three full weeks. Read them with the caveats in mind: **this is one user, my own projects and my own workload**, mostly on Opus, and the dollar figures are API-equivalent prices of the tokens, not a subscription bill. Every number has a query next to it in the repository (`docs/posts/sequential-by-design.sql`).

![The stats page: cost, weekly limits and spend by day per project (fake data)](https://raw.githubusercontent.com/NamerekT/even-keel/main/assets/screens/stats.png)

**Throughput.** The chain ran 428 tasks; 421 of them are closed. The median task cost $4.63 in API-equivalent tokens and took 15 minutes of active agent time. It used a median of **1.76 % of a weekly window** (p90: 4.33 %) — about 57 median tasks per window. My windows did run out in most weeks. That is the point: the window is the budget, and the chain spends it on finished tasks.

**The entry tax.** Before a session makes its first edit, it reads: the task, the rules, the area of the code. Across all chain sessions, **37 % of the spend ($929 of $2,521) went before the first edit.** That is per session, not per hour of work, and width does not make it smaller: ten agents pay it ten times, at once, in the same window.

What does make it smaller is not starting from zero. A long task that outgrows its context is handed to a fresh session in the same worktree, with a note from the previous one. Compare the two kinds of Opus sessions up to their first edit:

| | Sessions | Spend to first edit (median) | Context at first edit | Context at start |
| --- | ---: | ---: | ---: | ---: |
| Fresh session on a task | 371 | $1.51 | 114k | 33k |
| Continuation after a handoff | 318 | $0.74 | 74k | 35k |

A fresh session reads about 80k tokens of context before its first edit; a continuation about 40k. Half the entry.

What this table does not compare is the CLI's own auto-compaction. The handoff threshold sat below it, so in these three weeks not one chain session was auto-compacted, and I have not measured whether a compacted session is cheaper than a handoff or keeps the thread better. So these numbers say a handoff beats starting over, not that it beats the alternative everyone already has. That experiment started the day this period ended: a week of the chain with the handoff nudges out of the way, so the CLI compacts instead. The results go into the next post. If compaction wins, the nudges at the context threshold go — which would be a funny way for this section to age. Handoffs themselves stay: compaction keeps one session going, and some tasks have to go on in a new one — after a limit outlived the cache, or on another model.

**Waiting for me.** Of 170 hours of chain task time, **23 hours (13 %) were waiting for a human**: a question, a permission prompt, or the gap between the end of a session's turn and my next message. That gap counts even when the session had asked nothing and I simply looked later, so this is an upper bound; and it is a sum over tasks, not hours on the clock. It came in about 200 waits: 143 under five minutes, 50 of five to thirty, and three over an hour that make up a quarter of the total. 335 tasks, nearly four in five, never waited at all. Of 982 turns in chain sessions, 87 began with a message from me; the rest were started by the dispatcher, a background notification or another session.

**Going all night.** The longest stretch of uninterrupted chain work ran **16.4 hours, from 14:50 to 07:17 UTC the next morning.** In it: 12 tasks, all 12 closed; 32 handoffs at the context threshold across 9 of those tasks; one usage limit hit and waited out; three messages from me. On my workload, over this period, that is what a night looks like. It is not a claim that the problem is solved.

## Gas Town, and two lessons I take seriously

Steve Yegge built Gas Town, the most ambitious open orchestrator in this space — Beads, the worker roles, the merge queue. Much of what this category looks like comes from it. In August he wrote, in [*The Shape of Things to Come, Part 1: The Continuous Thunderdome*](https://yegge.ai/essays/the-shape-of-things-to-come/):

> "I did know that Gas Town never quite succeeded in getting my workers to go all night long."
>
> "It took too much elbow grease to keep it running."
>
> "Gas Town was intended to be reusable, but I only ever wound up using it to build itself."

He also writes that it "fell apart at the seams with Opus 4.7". I read that essay as an engineering report, not as a contrast to brag about: even with everything Gas Town had, the workers did not go all night. The numbers above are what it took for mine to, and most of it is unglamorous — waiting for limits, handing over context, keeping one question from stopping everything.

Two of his points apply to Even Keel too, and I want to answer them honestly.

**1. A change in the model's behaviour breaks the orchestrator.** Even Keel keeps the model out of the orchestration: the order comes from the tracker's `blocks` links, "done" is a branch merged into `main`, and the model decides nothing about the chain. A model that fiddles with the wrong thing produces a bad task, not a broken dispatcher.

Even Keel has its own version of this fragility, though: **it depends on undocumented behaviour of the Claude Code CLI** — `claude agents --json`, the `sessions/<pid>.json` records, the background daemon, the transcript format, the text of `/usage`. None of it is a public API, and the same goes for what it reads from the Codex CLI. It has already bitten: from 2.1.296 the CLI writes a pending `AskUserQuestion` into the transcript only once it is answered, and the page's chat stopped seeing open questions until Even Keel learned to read them from the session's job file.

So chain sessions do not run on whatever version the CLI has updated itself to. Even Keel downloads the version it was last checked against from Anthropic and runs them on that, with the auto-updater off, while my own `claude` keeps updating; Codex sessions are pinned the same way. A version becomes the checked one only after a live check takes one session through the calls the chain and the page make: the launch, a question, the answer, the handoff line, the stop.

The pin moves the fragility rather than removing it: Anthropic's servers may refuse an old version, an old version may not know a new model, and then the checked version has to be raised in a new release. The README says so up front and names the checked version; the guide lists the limits of the pin. And since I run my own work through Even Keel every day, I am likely to be among the first to hit a break and ship the fix.

**2. A harness should be part of the application, not reusable.** I agree with the premise, and I think Even Keel sits on the other side of it. It does not decide what to build or how: a human writes the tasks, and the per-application part — the rules, the checks, the definition of done — lives in each repository's own `CLAUDE.md`, skills and CI.

Even Keel is the plumbing between the tracker and the sessions: order, limits, handoffs, cleanup. That part is the same in every repository, but not one-size-fits-all. Each project sets its own:

- **tracker** — Huly, GitHub Issues or Linear, so one Even Keel can run a Huly project next to a GitHub one;
- **agent and model** — Claude Code or Codex, and which model of it; a tracker label switches both for a single task;
- **account** — which subscription its sessions spend, so a side project does not eat the main one's limits;
- **plugins and MCP servers** its sessions get;
- **commands** run before a session, as the project's own check and after a green `main`, and whether its CI guards `main`;
- **how a task lands** — a direct merge into the project's own main branch, or a pull request (experimental for now);
- **its own lines** in the session prompt.

When a session is nudged to hand over is not a guess either: once a project has enough handoffs behind it, the threshold is calibrated from that project's own history, and it can be pinned by hand.

## How it compares

Checked against each project's own documentation as of October 2026; a dash means I found nothing about it there. Corrections welcome — this moves fast.

| | Even Keel | OpenAI Symphony | Sortie | Cyrus | Gas Town |
| --- | --- | --- | --- | --- | --- |
| Shape | one task at a time per project | a spec with a reference implementation; 10 agents by default | a Go daemon, configurable concurrency | Linear/GitHub agent, hosted tiers or self-managed | many workers with a merge queue |
| Order by dependencies | yes, `blocks` | left to the tracker adapter | yes, holds issues with an open `blocked_by` | sub-issues in dependency order | dependency-aware ready lists (Beads) |
| A usage limit | waits for the reset, resumes the warm session or hands over | tracks the rate-limit payload, no pause defined | a failed run is retried | — | rate-limit scheduler, off by default |
| A long context | handoff to a fresh session in the same worktree | — | — | — | — |
| An agent's question | answer on the page, in the tracker or on the phone; only that task waits | reference policy: a hard failure | no answer channel | a dropdown in Linear | `gt escalate` |
| What you see | each session's stage, current action and context fill | tracker activity | logs and metrics | the tracker | a dashboard |
| Stats | per-task cost and time, stuck spans, before/after of rule changes | — | budgets, Prometheus metrics | — | — |
| Trackers × agents | Huly, GitHub, Linear × Claude Code, Codex (preview) | Linear × Codex | 5 trackers × 6 agents | several trackers × several agents | Beads × 11 agent presets |

Where the others are stronger: Sortie covers far more trackers and agents and has retries and budgets; Cyrus lives natively in the tracker; Gas Town does scale and a merge queue, which a sequential chain deliberately does not. A blocks-ordered chain is not unique any more either — Sortie and Cyrus both do a version of it. What I have not found elsewhere is the combination around a subscription: limits, a warm resume and a page to answer the agent from anywhere in one dispatcher, plus the statistics to see whether a change to your rules — or handoffs against compaction — made sessions cheaper or not.

![A project's chain: one task done, one session working, the rest queued; the panel on the right shows the session's stage, context fill and current action](https://raw.githubusercontent.com/NamerekT/even-keel/main/assets/screens/chain.png)

## What comes next

The backlog is longer than this post, and none of it is a promise. What I am most sure of:

- **Handoffs or compaction.** The experiment above decides whether the nudges at the context threshold stay, become a switch per project, or give way to the CLI's own compaction. Its results are the next post.
- **Statistics that suggest something.** The audit I run on my own sessions, as a skill any agent can run against Tally: compare a period with the one before it — before and after a rule edit, a model, a threshold — and say what got slower or more expensive and what to change.
- **Cheaper models.** A week of my own chain on Sonnet instead of Opus, to see how far the chain carries a weaker model and where it needs more help.
- **More agents.** OpenCode and GitHub Copilot CLI next to Claude Code and Codex; both have been checked against what the chain needs from an agent. And Claude sessions through the Agent SDK instead of the background CLI: that could trade part of the undocumented behaviour above for a documented API, and a study comes first to see what it costs in return.
- **Easier to install and update.** One executable for the program, the service and the update, and an update from a button on the page that rolls itself back if the service does not come up.
- **More than one chain per repository.** A released version and the next one run as two chains over one tracker project — the way Even Keel itself is now built, by hand; and projects that share a remote wait together on a red `main` with one fix for it.
- **Further out:** several machines behind one page, a queue to review merged tasks after the fact rather than a gate before them, and a forecast of how much of the queue fits into what is left of the window tonight.

## Try it

You need Node.js 24, git, the Claude Code CLI signed in with your subscription (the Codex CLI only for Codex tasks) and a Huly workspace, GitHub repositories with Issues or a Linear workspace.

```sh
git clone https://github.com/NamerekT/even-keel && cd even-keel
npm install && npm run build && npm start
```

The first start opens a wizard that adds a project. `npm run dev:fake` shows the page on fake data first, with no tracker and no sessions. Windows is where it runs every day; Linux was checked end to end; macOS should work but has not been checked. MIT licensed.

If you run it, I'd like to hear where the chain stopped and why — that is the part that took the most work and still has the most to learn. What I could never check on my own machine is listed in [docs/unverified.md](https://github.com/NamerekT/even-keel/blob/main/docs/unverified.md), the most likely to hurt first; a run into one of those is the report I want most.
