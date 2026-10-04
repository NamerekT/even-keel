---
name: setup
description: Putting a repository on the Huly tracker once — the Huly project, its components and first milestone, the tracker block in the project's CLAUDE.md, the plugin enabled for the project and its entry in Even Keel's config. Load it when the user asks to start tracking a repository in Huly ("put this project on the tracker", "we need Huly here", "let's keep tasks for this"). Not for the day-to-day work on tasks — that is `huly:task`.
---

# Putting a repository on Huly

Once per repository, and only after the user has agreed to it.

## 1. Huly

1. `list_projects` — make sure no project already covers this repository. If one does, stop and ask whether to use it.
2. `create_project(name, identifier, description)` — the identifier is the task key: 2–3 uppercase letters (the server allows up to 5), short, because it goes into every branch and commit. A meaningful name and a one- or two-sentence description: what the repository is and what it is built on.
3. `create_component` for the obvious areas of the code (`Frontend`, `API`, `Infra`, `Tooling`, …) — two to five; more come when they are actually needed.
4. `create_milestone(project, label, targetDate)` for the nearest version slice, `v0.1`. `targetDate` is required; it is an estimate, not a promise. The milestone description is the map of the slice — its contents and their order.

Write the descriptions in the language the user wants the tasks in; ask if it is not obvious.

## 2. The project's `CLAUDE.md`

Add the block below — create the file if there is none, append a section if there is, leave the rest untouched. Put in the key, the language, and the merge rule the user wants. Translate the block into the language of that `CLAUDE.md`. Do not copy the rules of `huly:task` into it — they live in the skill.

```markdown
## Tasks

Work in this repository is tracked in Huly, project `ABC`. Rules and the workflow — the `huly:task` skill; read it before creating a task or starting one.

- Code is written for an active task, in its worktree. A direct request without a task is committed to `main` of the main checkout.
- Branch: `abc-<number>/short-description`. Commit: `[ABC-<number>] Message`.
- Task content (titles, descriptions, comments) is written in <language>.
- The session merges its branch into `main` itself (`git merge --no-edit` in the main checkout); that closes the task.
```

The branch shape `<key>-<number>/<something>` matters: Even Keel and git hooks find the task from it.

## 3. The plugin for the project

The tracker tools must appear in this project and in every worktree made from its `main`:

1. In the repository root: `claude plugin install huly@even-keel --scope project`. If the marketplace is unknown, the user adds it first — `claude plugin marketplace add <Even Keel repository>` — with the default Claude Code config, no `CLAUDE_CONFIG_DIR`.
2. Commit `.claude/settings.json` with its `enabledPlugins` to `main`. A worktree made from a `main` without it has no plugin.
3. The Huly credentials are the user's: `HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` (or `HULY_EMAIL` and `HULY_PASSWORD`) in the `env` of their `~/.claude/settings.json`. Do not ask for them in chat and never write them into the repository.
4. The plugin loads in a new session; this one does not get its tools.

## 4. Even Keel

If the user runs Even Keel, the project needs an entry in its `even-keel.config.json`. The session reads the task through the plugin itself, so the brief is off:

```json
{ "projects": { "ABC": { "repo": "<absolute path of the main checkout>", "brief": false } } }
```

That file belongs to the user's Even Keel install: change it only when they say so, otherwise hand them the entry. `projects` takes effect after Even Keel restarts.

## 5. Report

The project key, the components, the milestone, what was committed, and what is left for the user: credentials, the marketplace, the Even Keel entry and its restart.
