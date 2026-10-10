#!/usr/bin/env node
// Stop guard: a session that wrote the handoff note at the end of its turn but closed
// with a report instead of the CHECKPOINT line is sent back to add the line.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { missingMark } from "./handoff.mjs";

const TAIL_BYTES = 1 << 20;

function tailOf(path) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function entriesOf(path) {
  const entries = [];
  for (const line of tailOf(path).split("\n")) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // The first line of the tail is usually cut, the last one may be unfinished.
    }
  }
  return entries;
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (input && !input.stop_hook_active && !input.agent_id && input.transcript_path && typeof input.last_assistant_message === "string") {
  try {
    if (missingMark(entriesOf(input.transcript_path), input.last_assistant_message)) {
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
  } catch {
    // A missing or unreadable transcript must never keep the session from stopping.
  }
}
