#!/usr/bin/env node
// PreToolUse guard on Bash: a chain session's merge of its task branch waits for the project's check,
// run in the task's worktree. Even Keel gives the commands only when no CI it counts will judge main;
// a failed command blocks the merge, and its output goes back to the session to fix.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mergesBranch, refusal } from "./merges.mjs";

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
async function commandsOf(sessionId) {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/check`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body?.commands) ? body.commands.filter((command) => typeof command === "string" && command.trim() !== "") : [];
}

async function main() {
  const input = readInput();
  if (!input || input.tool_name !== "Bash" || !input.session_id) return;
  if (!String(input.tool_input?.command ?? "").includes("merge")) return;
  const root = git(process.env.CLAUDE_PROJECT_DIR || input.cwd || ".", ["rev-parse", "--show-toplevel"]);
  const branch = root === "" ? "" : git(root, ["branch", "--show-current"]);
  if (branch === "" || branch === "main" || !mergesBranch(input.tool_input?.command, branch)) return;
  let commands;
  try {
    commands = await commandsOf(input.session_id);
  } catch {
    return;
  }
  for (const command of commands) {
    const run = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (run.status === 0) continue;
    const output = [run.stdout, run.stderr, run.error?.message].filter(Boolean).join("\n");
    process.stderr.write(refusal(command, run.status ?? -1, output));
    process.exit(2);
  }
}

// Even Keel not answering must never block a merge.
main().catch(() => {});
