---
name: split
description: Size of a task and splitting it into subtasks through Even Keel's tasks MCP server (any tracker of an Even Keel project) — when a split is worth it, how to propose it, how to create the children in one call. Load it when a task looks big, holds an unchosen fork or bundles a side bug, or when the user asks to split a task. Not for small tasks that are simply done.
---

# Splitting a task

Every session pays an entry fee: rules, task, reading the code. A long task carried on by a handoff is cheaper than the same work cut into tasks that each read the area again. **Split for correctness, not for cost.** The project's `CLAUDE.md` or the user may rule otherwise — that wins.

## 1. When

1. **An unchosen fork** — options with none picked: a blocking question first (`tasks:task` §3), not a split.
2. **A side bug or idea** — always its own task.
3. **A piece checked differently** — checking one says nothing about the other.
4. **Numbers nobody set** that are the user's to choose.

Many results or several layers alone are no reason. Cut along the seams of the domain; a trifle (a rename, a docs line) is no task; at most three pieces in one area. Check when the task is worded, right after reading it, and again after the first look at the code.

## 2. Proposing

A split is always proposed, never done silently: the split / as is / otherwise. "As is" is final.

## 3. Creating the children

One `tasks_create` call: each child with `parent: "<parent key>"`, `status: "Todo"`, the parent's milestone, its own priority, order between them by `blocks: ["#2"]`, and a `retry`. Then `task_update(<parent>, append: "## Split\n…")` — what went into which child, what was left out. Children are self-contained; commits name only the child's id, never the parent's. Even Keel closes the parent once all its children are closed.

## 4. Then the session ends

Take no child here — no worktree, no branch, no edits. List the children's keys and stop: Even Keel starts each in its own session.
