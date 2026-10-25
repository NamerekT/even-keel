#!/usr/bin/env node
// PreToolUse guard for Huly writes: refuses markdown that puts inline code inside
// another mark, which the server accepts and Huly's editor then cannot open.
import { readFileSync } from "node:fs";
import { marksRefusal } from "./marks.mjs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const reason = marksRefusal(input?.tool_input);
if (reason !== null) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}
