#!/usr/bin/env node
// PostToolUse nudge: once the main thread's context passes the first threshold, again every
// step after that and every late step past the late threshold, tell the agent how big it is
// and ask for a checkpoint. The first nudge lets it pick the moment; the later ones do not,
// since sessions kept citing "the next step needs what is loaded". The context, the project's
// threshold and how many handoffs the task has had come from Even Keel, which reads the
// transcript of either agent (nudges.mjs); a session Even Keel did not start is left alone.
import { readFileSync } from "node:fs";
import { checkpointNote, contextOutput } from "./evenkeel.mjs";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const input = readInput();
  if (!input || input.agent_id || !input.session_id) return;
  const note = await checkpointNote(input.session_id);
  if (note === null) return;
  process.stdout.write(JSON.stringify(contextOutput("PostToolUse", note)));
}

// No Even Keel, or no answer in time, must never break the tool call.
main().catch(() => {});
