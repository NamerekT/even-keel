#!/usr/bin/env node
// PreToolUse on Huly calls that set an estimate: adds the project's estimate calibration from Even Keel
// to the agent's context, once per session and project. When the step sent disagrees with the data, that one
// call is refused with the calibration instead, and the retry goes through. No Even Keel, no statistics, no data — silent.
import { readFileSync } from "node:fs";
import { calibrationContext } from "./calibration-context.mjs";

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const context = await calibrationContext(input.session_id, input.tool_name, input.tool_input);
  if (context === null) return;
  const { text, refused } = context;
  const output = refused
    ? { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: text }
    : { hookEventName: "PreToolUse", additionalContext: text };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: output }));
}

main().catch(() => {});
