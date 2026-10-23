#!/usr/bin/env node
// Stop guard: a session that wrote the handoff note at the end of its turn but closed
// with a report instead of the CHECKPOINT line is sent back to add the line. Whether the
// turn wrote the note comes from Even Keel, which reads the transcript of either agent.
import { readFileSync } from "node:fs";
import { noteAtEnd } from "./evenkeel.mjs";
import { hasMark } from "./handoff.mjs";

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!input || input.stop_hook_active || input.agent_id || !input.session_id) return;
  if (typeof input.last_assistant_message !== "string" || hasMark(input.last_assistant_message)) return;
  if (!(await noteAtEnd(input.session_id))) return;
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        "You wrote `.temp/handoff.md` at the end of this turn, but your last message does not end with " +
        "the line `CHECKPOINT: .temp/handoff.md`, so Even Keel will not hand the task to a fresh session " +
        "and will wait for a reply instead. Reply with that line alone, nothing before or after it.",
    }),
  );
}

// No Even Keel, or no answer in time, must never keep the session from stopping.
main().catch(() => {});
