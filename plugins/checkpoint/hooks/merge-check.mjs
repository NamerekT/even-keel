#!/usr/bin/env node
// PreToolUse guard on Bash: a chain session's merge of its task branch waits for the project's check,
// run in the task's worktree. Even Keel gives the commands only when no CI it counts will judge main;
// a failed command blocks the merge, and its output goes back to the session to fix.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mergesBranch, mergeRefusal } from "./merges.mjs";

const BASE = (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");
const COMMAND_TIMEOUT_MS = 20 * 60_000;

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return "";
  }
}

/** Empty — no check: Even Keel did not start this session, the project has none, or a CI will judge main. */
/** The commands and the project's main branch; the branch is `main` when Even Keel does not name one. */
async function checkOf(sessionId) {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/check`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return { commands: [], main: "main" };
  const body = await response.json();
  const commands = Array.isArray(body?.commands) ? body.commands.filter((command) => typeof command === "string" && command.trim() !== "") : [];
  return { commands, main: typeof body?.branch === "string" && body.branch !== "" ? body.branch : "main" };
}

async function main() {
  const input = readInput();
  if (!input || input.tool_name !== "Bash" || !input.session_id) return;
  if (!String(input.tool_input?.command ?? "").includes("merge")) return;
  const root = git(process.env.CLAUDE_PROJECT_DIR || input.cwd || input.tool_input?.workdir || ".", ["rev-parse", "--show-toplevel"]);
  const branch = root === "" ? "" : git(root, ["branch", "--show-current"]);
  if (branch === "" || !mergesBranch(input.tool_input?.command, branch)) return;
  let check;
  try {
    check = await checkOf(input.session_id);
  } catch {
    return;
  }
  const { commands } = check;
  if (branch === check.main) return;
  for (const command of commands) {
    const run = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (run.status === 0) continue;
    const output = [run.stdout, run.stderr, run.error?.message].filter(Boolean).join("\n");
    process.stdout.write(JSON.stringify(mergeRefusal(command, run.status ?? -1, output)));
    return;
  }
}

// Even Keel not answering must never block a merge.
main().catch(() => {});
