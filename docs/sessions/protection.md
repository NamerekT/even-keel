# Sessions: protection, project rules and standards

## Protection

`src/sessions/protection.ts` defines eleven default deny groups. `protection` has `disabled` (group ids), `claude`
(permission strings), `codex` (arrays of literal command-prefix arguments), `copilot` (tool rules), and `opencode`
(bash command glob patterns). Fields inherit
from the shared level; a project's field replaces the shared one, including an empty list. Group ids are `forcePush`,
`mirrorPush`, `deleteRemote`, `deleteRoot`, `deleteHome`, `deleteParent`, and one per tracker (`TRACKER_GROUPS`):
`deleteHuly`, `deleteGithub`, `deleteGitlab`, `deleteLinear`, `deleteJira`. Sessions → Protection
edits them. New launches read current values; running processes are left alone. These are pattern guardrails, not an
OS sandbox or a guarantee against equivalent commands.

The tracker groups (BTN-541) are enforced in the MCP gateway, not by the agents: it refuses a tracker server's
deleting `tools/call` for every agent, Codex included, also one nested in a dispatcher such as Huly's `invoke_tool`
(BTN-641; `docs/packages.md`, "The gateway"). Native rules match tool names only and miss such a call. `deleteHuly` also keeps
Huly's native deny rules for Claude, Copilot and OpenCode; the other trackers have none (native lists per tracker are
an idea for 0.3). The page shows "Deleting tracker records" over the five tracker switches; it stores nothing: it is on
while all five are, and turning it on or off turns them all. A project's "Use shared protection" does not lock the
fields: on means the project has no `protection` of its own; changing a field copies the shared values with the change
and turns it off; turning it on drops the project's values.

Claude receives `permissions.deny` in its chain `--settings`, with trimming on or off, including SDK transport. The
harness refusing a shared and a project rule in a `--bg` chain session, the project's saved on the running service,
is in [`verified.md`](../verified.md) (Sessions); the SDK transport is not checked live.
Copilot receives `--deny-tool` alongside `--allow-all-tools`. Its `shell(...)` rules are the same literal prefixes as
Codex's, written `shell(<prefix>:*)` with the folder's remotes (`git remote` before each turn): Copilot matches a
command's leading words and treats a `*` anywhere but a trailing `:*` as no wildcard, so the earlier
`shell(git push * --force*)` forms let `git push -f origin main` through (BTN-463). A flag after the branch still
escapes these prefixes. Copilot also receives the five literal force-refspecs of the project's main branch listed
below, with `mainBranch` passed on launch and resume (EKR-74). Huly deletion rules
name the plugin gateway and standalone server; the server names Copilot sees for them were not checked live. Codex cannot deny MCP calls through execpolicy. Each group's hint names what it denies, and
each agent's field of additional rules has its own hint and an example placeholder. An agent without a sandbox and without Even Keel rules gets a warning linking
to the project's session settings.

Git's global options before `push` (`-C <dir>`, `-c <k=v>`, `--git-dir=…`, `--no-pager`) shift a command past the
`git push` patterns (BTN-642). Claude and OpenCode get every push pattern a second time as `git -* push …`: any run
of options starting with `-` between `git` and `push`, so `git commit -m "push --force"` stays allowed. Codex and
Copilot have no wildcard inside a prefix and get only `git -C . push …` and `git --no-pager push …`. Not caught there:
`-C` with any other folder (the worktree's absolute path included), `-c`, `--git-dir`, `--work-tree`, several global
options together. Not caught anywhere: an alias (`git config alias.p push`), a `+` refspec in the remote's
`remote.<name>.push` config, a push hidden in a script or shell wrapper. Checked by unit tests only
([unverified.md](../unverified/opencode.md#opencode-protection-btn-486)).

OpenCode receives the native groups through `OPENCODE_CONFIG_CONTENT` (`sessionConfig`): command patterns as
`permission.bash[pattern]: "deny"`, and Huly deletion tools as `permission[<gatewayName>_<tool>]: "deny"`.
Plugin and standalone Huly servers use their actual gateway names; without a package list, the conventional
`plugin_huly_huly` and `huly` names cover the account's own servers. Reading and updating tracker records stay allowed.
`external_directory: "allow"` still permits the merge into the main checkout. Additional `protection.opencode` rules
are command patterns, one per line in the editor (for example, `git reset --hard*`); no tool-name wrapper is needed.
They share the command patterns of Claude's groups, including `+` and `:` push refspecs and paths starting with the
recursive-delete targets. They do not cover every equivalent spelling or shell wrapper.

When any Protection rule is active, `sessionConfig` also loads Even Keel's built-in `protection-plugin` last, after
the package plugins. Its config hook runs after OpenCode has merged the account, project and inline configuration.
It appends the active native denies to both the top-level permissions and every configured agent's permissions,
including `build`. Existing matching keys are removed before reinsertion: assigning an existing key would retain
its position before a later wildcard allow. Scalar permissions become a `*` entry; unrelated rules keep their
order. Account and project files are untouched. With every group off and no custom rules, no overlay is loaded.

The [OpenCode permissions documentation](https://opencode.ai/docs/permissions/) and the installed 1.18.25 source
(`permission/index.ts`, `core/src/util/wildcard.ts`) agree: `*` matches any text, `?` one character, and the last
matching permission wins. Backslashes normalize to slashes and matching ignores case on Windows. Agent-specific
permissions can override the config's permissions; these are native guardrails, not a sandbox. Checked live on
Windows with OpenCode 1.18.25 (BTN-500): all seven group switches, push flags in both common orders, force/delete
refspecs, recursive-delete targets, custom `*`/`?` patterns, and Huly deletion tools through the real gateway. The
provider emitted tool calls against a local bare remote and safe recording stubs. Deletion tools are removed from
the offered tool set; forced calls become unavailable-tool results, while reads and updates reach the MCP stub.
Top-level account/project broad allows leave the denies effective. Shared and project rules saved through the
running service's page reached new chain sessions without a restart; a project's rule list replaced the shared one.
The build-agent override found there was corrected in BTN-501: scalar, broad, explicit MCP-tool and late wildcard
allows from either layer leave Protection denies effective. The source and compiled transport were checked live;
neither the `rm` stub nor the deletion MCP stubs received the denied calls. Results are in
[verified.md](../verified.md); remaining platforms and subagents are in
[unverified.md](../unverified/opencode.md#opencode-protection-btn-486). No separately installed package is needed. The retained
**OpenCode Protection** test project and `.temp/btn-500/README.md` and `.temp/btn-501/README.md` in the main checkout
describe how to repeat the safe checks.

Codex receives `.codex/rules/even-keel.generated.rules` in the working folder, added to git's local exclude. Account
folders and existing rule files are untouched; a collision with a file without the generated header fails the launch.
The file is refreshed before a CLI turn (including resume) and loaded at startup. Slot reuse replaces only this file.
Other Codex project configuration retains its normal trust requirements. Checked on Codex 0.164.0 with a local
Responses server sending a harmless `echo` tool call: a `forbidden` prefix was rejected under bypass in the account
and project config layers. [Codex rules](https://developers.openai.com/codex/rules/) match literal argv prefixes:
defaults cover push flags immediately after `git push` or after a configured remote, and literal dangerous `rm`
targets. For each remote and the project's main branch (`mainBranch` of `SessionStart`), Codex and Copilot get
`+<branch>`, `+HEAD:<branch>`, `+<branch>:<branch>`, `+<branch>:refs/heads/<branch>` and `+HEAD:refs/heads/<branch>`.
Only Codex gets deletion refspecs (`:<branch>`, `:refs/heads/<branch>`) and the additional rm targets `C:\`, `D:\`, `~/`, `$HOME/`,
`../`, `/*` (BTN-462). Missing branch or remotes produce no refspec rules; disabling `forcePush` removes the five
force forms. Other argument orders, refspecs of other branches, expanded paths, shell variants and MCP are not covered.
Additional prefixes can cover a project's commands. Remaining live checks are in `docs/unverified.md`.

## Project rules for every agent (BTN-340, `src/agent/projectRules.ts`)

A project set up for one agent keeps its rules when a run profile switches to another. The table of what each agent reads is `READS` in `src/agent/projectRules.ts`, shared by the adapters, the packages check (`pluginReach`) and the page's "What the session gets" (`docs/web.md`). Checked live on 2026-10-24 on Windows, with a scratch repository per case (only `CLAUDE.md`, only `AGENTS.md`, both; each file with its own secret word, a skill in each of `.claude/skills`, `.agents/skills`, `.codex/skills`, `.github/skills`, `.opencode/skills`), asking the session for the words and the skills in its context: Claude Code 2.1.309 (`claude -p` and `--bg`, Haiku), codex-cli 0.164.0 (`gpt-5.6-luna`), OpenCode 1.18.25 (`big-pickle`, with the account folder and flags of a chain session), Copilot CLI 1.0.103 (`copilot instruction list`, `copilot skill list`).

| Agent | Only `CLAUDE.md` | Only `AGENTS.md` | Both | Skill folders |
| --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | `AGENTS.md`, passed by Even Keel | `CLAUDE.md` | `.claude/skills` |
| Codex | `CLAUDE.md`, passed by Even Keel | `AGENTS.md` | `AGENTS.md` | `.agents/skills`, `.codex/skills` |
| OpenCode | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` | `.opencode/skills`; `.claude/skills`, `.agents/skills` passed by Even Keel |
| Copilot | `CLAUDE.md` | `AGENTS.md` | both | `.github/skills`, `.agents/skills`, `.claude/skills` |

- **Claude Code does not read a lone `AGENTS.md`.** The 2.1.309 binary has the line "no CLAUDE.md found; AGENTS.md loaded", but behind a gate that is off: the session did not know the file's word. `agentsFallback` (`src/claude/instructions.ts`) finds an `AGENTS.md` in a folder with neither `CLAUDE.md` nor `.claude/CLAUDE.md`, and the launch and every resume pass it as `--append-system-prompt-file` (`sessionArgs`); a `--bg` session started so knew the word. The SDK transport puts the file's text into `systemPrompt.append` of the `claude_code` preset (`sessionOptions` in `src/claude/sdk/host.ts`), never seen live (`docs/unverified.md`).
- **Codex reads `CLAUDE.md` only when told.** Without an `AGENTS.md` it knew no word; `turnArgs` passes `-c project_doc_fallback_filenames=["CLAUDE.md"]` on every turn, and with both files Codex still takes only `AGENTS.md`.
- **Codex has no way to `.claude/skills`.** It lists `.agents/skills` and `.codex/skills` only; a `skills.config` entry with the path of a `.claude/skills/<name>/SKILL.md` adds nothing (0.164.0). A project that wants its skills in Codex sessions keeps them in `.agents/skills`, which Claude Code in turn does not read.
- **OpenCode** reads `AGENTS.md`, else `CLAUDE.md`, by itself (`OPENCODE_DISABLE_CLAUDE_CODE` would drop the latter). Of the skill folders, `OPENCODE_DISABLE_EXTERNAL_SKILLS` drops the project's `.claude/skills` and `.agents/skills` with the home folder's, and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` the `.claude/skills` ones; `.opencode/skills` stays. With both flags on, the two project folders passed in `skills.paths` came back (`skillDirs` in `src/opencode/cli.ts`).
- **Copilot** reads both files when both are there, and three skill folders, all without any help.
- What a session gets is what is committed on the project's branch: a worktree is checked out from it, so an uncommitted `CLAUDE.md` or skill of the main checkout reaches no chain session. The page reads the same through `git ls-tree -r --name-only <branch>` (`readRepoRules` in `src/tools/panel.ts`, `ToolsView.rules`); only a skill's `SKILL.md` one level under a folder counts (`repoRulesOf`).

## The check before the merge

The merge guard (`merge-check.mjs`) returns `hookSpecificOutput.permissionDecision: deny` on a failed check. On Codex 0.164.0, a command hook's exit code 2 alone did not block a code-mode `exec_command`; the explicit denial did. The nested call's hook input is `tool_name: Bash`, `tool_input: { command }`, with the session's `cwd`: the command's `workdir` is absent even when it differs. The guard checks the branch and runs the check in the session's worktree, so a merge command running in the main checkout still checks the task. Checked live on Windows on 2026-10-25: a red check held main unchanged, a green check allowed the merge, and a shell-written note was already in the rollout when `checkpoint-mark` asked, so its Stop block made Codex add the mark.

## Project standards (BTN-359)

A standard is a document of the project's repository and the files it guards: the project setting `standards`, a list of `{ doc, files, except, shots }` (`Standard` in `src/state.ts`, checked by `standardsOf` in `src/projects/standards.ts`; `docs/settings.md`). The masks are globs from the repository's root: `**/` any folders, `*` and `?` within one path part, an exception wins. The page edits it in the project's Sessions tab (`ProjectStandards.tsx`), the document picked from the Markdown files committed on the project's branch (`ToolsView.docs`, `readBranchDocs` in `src/tools/panel.ts`), one the branch lacks is warned about; "Add "Interface"" adds `INTERFACE_FILES` with `DEFAULT_EXCEPT` and the merge's check on, `docs/design.md` when the branch has it. "What the session gets" lists the documents.

The `checkpoint` plugin holds them, from 0.12.0 (`plugins/checkpoint/hooks/standards.mjs`, the hook command `standard-gate.mjs`). The hook asks `GET /api/sessions/<id>/standards` (`{ standards }`, the same answer as `/check` has; 404 for a session the chain did not start, and then it says nothing):

- `PostToolUse` of a read (`Read`, Copilot's `view`, `read_file`) of a guarded file adds the document, whole, in `additionalContext` inside `<standard path="…">`, with a line on what the merge will want when `shots` is on.
- `PreToolUse` of an edit (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, Codex's `apply_patch` — its paths from the patch's `*** Update File:` lines —, Copilot's `edit`/`create`/`str_replace`; Copilot 1.0.98 sends its `apply_patch` as `Edit` with the patch as a bare string `tool_input`, whose paths `callOf` takes from the same lines, BTN-640) of a guarded file whose document the session has not had is denied with the document as the reason; the edit after it goes through.
- What was given is kept per session (and per subagent: `agent_id`) in `<session>.standards.json` of the temp folder's `claude-context-checkpoint/`, beside the threshold's marks; `SessionStart` with `compact` or `clear` drops the session's own, so the document comes again after a compaction.
- The merge: `mergeRefusal` (`hooks/merges.mjs`, shared by `merge-check.mjs` and the OpenCode plugin) runs `standardsRefusal` before the project's check commands. For each standard with `shots` whose files `git diff --name-only <main>...HEAD` names, it wants pictures in `.temp/shot/` (any depth) newer than the newest mtime of those files, then `.temp/<document's name>-check.md` newer than the pictures, holding each question of the document's section "The check" (its list items ending with "?", up to the next heading of the same level) with words after it before the next question. Committed changes only: the diff is of the branch, not of the worktree. A git that cannot tell lets the merge go.
- PR mode has no merge: the `Stop` hook refuses a turn whose last line is the `PULL REQUEST` mark with the same text (`decision: block`), once — a turn already stopped by a hook (`stop_hook_active`) goes.

OpenCode gets the same from `opencode/checkpoint.mjs`: the read on `tool.execute.after` (appended to the output), the edit on `tool.execute.before` (thrown), the marks dropped on the `session.compacted` event, the merge with the merge check. Its turn's end cannot be blocked, so PR mode's mark is not held there.
