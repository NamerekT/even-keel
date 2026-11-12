#!/usr/bin/env node
// PreToolUse guard on a shell call: a session of a project whose git is off in Even Keel is refused any call of git,
// also one the agent's own deny rules miss (a compound command, a wrapper, another shell). Even Keel is asked only
// when the command calls git.
import { readFileSync } from "node:fs";
import { checkOf } from "./evenkeel.mjs";
import { gitRefusal } from "./gitban.mjs";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const input = readInput();
  if (!input || !input.session_id) return;
  const command = typeof input.tool_input === "string" ? input.tool_input : input.tool_input?.command;
  const text = await gitRefusal(command, () => checkOf(input.session_id));
  if (text === null) return;
  // An explicit denial: Codex ignores exit code 2 alone for the nested shell calls of code mode.
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: text } }));
}

// Even Keel not answering leaves the call to the agent's own rules.
main().catch(() => {});
