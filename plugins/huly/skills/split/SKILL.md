---
name: split
description: Size of a Huly task and splitting it into subtasks — when a split is worth it, how to propose it, and how to create the children so that Even Keel runs them one by one. Load it when a task picked up looks big, holds an unchosen fork or bundles a side bug; when the first look at the code shows the task is bigger than its text said; when the user asks to split a task or to plan a feature as several tasks. Not for small tasks that are simply done.
---

# Splitting a Huly task

Every new session pays an entry fee before its first useful line: the rules, the task, reading the area of the code. A long task carried on by a handoff in the same worktree is cheaper than the same work cut into tasks that each read the area again. So size alone is not a reason to split. **Split for correctness, not for cost.**

The project's `CLAUDE.md` or the user may rule splits out entirely, or set other thresholds — that wins over this skill.

## 1. When to split

Split when one of these holds:

1. **An unchosen fork** — options were put forward, none was picked. The decision comes first, then the task; the fork is a blocking question (`huly:task` §3), not a split.
2. **A side bug or idea** mentioned in passing — it always becomes its own task.
3. **A piece is checked differently** — a model in an editor against code, a unit test against a rendered frame — and checking one says nothing about the other.
4. **Numbers nobody set** — values that are the user's to choose, unless the project's `CLAUDE.md` gives them to the agent.

Not reasons on their own: many observable results, several layers (core, rendering, UI, saves) — such a task is done whole.

- **Cut along the seams of the domain, not by volume.** Each piece stands on its own, is checked on its own and lands in its own commit. A cut through the middle of one layer is worse than no cut: the pieces take different decisions about the same thing.
- **A trifle is not a task.** A rename, removing what was replaced, a docs line, a two-line fix goes into a task that touches those files anyway. A separate task for it costs a whole session entry for a few lines.
- **At most three pieces in one area.** Each piece is a new session that reads the same code again. If the seams give more than three pieces in one layer and the same files, merge neighbours.

## 2. When to check

- **The task is born in conversation** — name the split right there, while wording it: the answer comes in the same minute.
- **The task is already in the tracker** — right after `get_issue`, before reading any code: splitting halfway costs more than not starting.
- **Again after the first look at the code.** The signs read the task text; the code can show more — the task changes something the program treats as a primitive, needs new state, a data migration or a new rule. Then say in a line or two what it drags in and roughly how big it is, and offer the heavy piece as a child before writing tests. A scope nobody named turns a long task into a surprise.

## 3. Proposing

- **A split is always proposed, never done silently** — it changes the plan of work, and the plan is the user's. Ask with options: the split as proposed / do it as is / otherwise.
- "Do it as is" is final: the task is taken whole.
- Who created the task does not matter: a task created by the agent's account is usually written from the user's words.

## 4. Creating the children

A split is subtasks, not a scatter of new tasks. The big task stays the parent.

- `create_issue(project, title, description, priority, estimation, parentIssue: "<parent id>", status: "Todo")` — accepted means ready: the children go straight into the chain. Same component and milestone as the parent; priority and estimate per child (`huly:task` §5).
- **The parent is the map of the split.** Add a section at the end of its description: what went into which child, and what was left out. Do not rewrite the user's text in it.
- **Each child is self-contained:** its own check, its own branch, its own commit. Order between children, if any — `blocks` relations, not prose.
- **Commits name only the child's id, never the parent's.** Hooks and integrations close every task whose id reaches `main`; the parent's id would close the umbrella before the other children are done.
- **The parent closes last:** the session that merges the last open child moves the parent to its done status by hand (`list_statuses` for the name).

## 5. After the split the session ends

Do not take any child in the same session — no worktree, no branch, no edits. The last message lists the children with their ids, and stops.

Even Keel drops a task with children out of the chain the moment they appear and starts the first child in its own session and worktree. A child taken on here as well gets a second session in the same files, and the two overwrite each other's work.
