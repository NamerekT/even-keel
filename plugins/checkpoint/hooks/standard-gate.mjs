#!/usr/bin/env node
// The project's standards (standards.mjs) for Claude Code, Codex and Copilot: after the first read of a file a standard
// guards, its document goes into the context; the first edit of one before that is refused with the document as the
// reason; a compaction forgets what was given, so the document comes again. In PR mode a turn that ends with the
// PULL REQUEST mark is sent back while the standard's check is not done, as the merge is refused (merges.mjs). A
// subagent keeps marks of its own. A session Even Keel did not start, or a project without standards, is left alone.
import { readFileSync } from "node:fs";
import { checkOf, STATE_DIR, standardsOf } from "./evenkeel.mjs";
import { callOf, clearGiven, due, givenStore, standardsAt, standardsRefusal, wantsPullRequest } from "./standards.mjs";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

async function onTool(input, root) {
  const moment = input.hook_event_name === "PostToolUse" ? "after" : "before";
  if (!due(moment, callOf(input.tool_name, input.tool_input))) return null;
  const standards = await standardsOf(input.session_id);
  if (standards.length === 0) return null;
  const found = standardsAt(moment, input.tool_name, input.tool_input, root, standards, givenStore(STATE_DIR, input.session_id, input.agent_id));
  if (found === null) return null;
  if (found.give !== undefined) return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: found.give } };
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: found.deny } };
}

async function onStop(input, root) {
  if (input.stop_hook_active || input.agent_id || !wantsPullRequest(input.last_assistant_message)) return null;
  const check = await checkOf(input.session_id);
  const text = await standardsRefusal(root, check.main, check.standards, true);
  return text === null ? null : { decision: "block", reason: text };
}

async function main() {
  const input = readInput();
  if (!input || !input.session_id) return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || ".";
  const event = input.hook_event_name;
  if (event === "SessionStart") {
    if (input.source === "compact" || input.source === "clear") clearGiven(STATE_DIR, input.session_id);
    return;
  }
  const output = event === "Stop" ? await onStop(input, root) : event === "PreToolUse" || event === "PostToolUse" ? await onTool(input, root) : null;
  if (output !== null) process.stdout.write(JSON.stringify(output));
}

// No Even Keel, or no answer in time, must never break the tool call or keep the session from stopping.
main().catch(() => {});
