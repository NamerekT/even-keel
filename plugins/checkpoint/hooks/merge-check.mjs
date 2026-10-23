#!/usr/bin/env node
// PreToolUse guard on Bash: a chain session's merge of its task branch waits for the project's check,
// run in the task's worktree. Even Keel gives the commands only when no CI it counts will judge main;
// a failed command blocks the merge, and its output goes back to the session to fix.
import { readFileSync } from "node:fs";
import { checkOf } from "./evenkeel.mjs";
import { mergeRefusal } from "./merges.mjs";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const input = readInput();
  if (!input || input.tool_name !== "Bash" || !input.session_id) return;
  const cwd = process.env.CLAUDE_PROJECT_DIR || input.cwd || ".";
  const text = await mergeRefusal(input.tool_input?.command, cwd, () => checkOf(input.session_id));
  if (text === null) return;
  process.stderr.write(text);
  process.exit(2);
}

// Even Keel not answering must never block a merge.
main().catch(() => {});
