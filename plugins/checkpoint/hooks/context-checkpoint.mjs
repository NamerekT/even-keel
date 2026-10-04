#!/usr/bin/env node
// PostToolUse nudge: once the main thread's context passes FIRST tokens, and again
// every STEP tokens after that, tell the agent how big it is and ask for a
// checkpoint before a loop of checks, where every turn re-reads the whole context.
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tokensFrom(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const FIRST = tokensFrom("CHECKPOINT_FIRST_TOKENS", 150_000);
const STEP = tokensFrom("CHECKPOINT_STEP_TOKENS", 50_000);
const TAIL_BYTES = 1 << 20;
const STATE_DIR = join(tmpdir(), "claude-context-checkpoint");

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

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

function contextOf(transcriptPath) {
  const lines = tailOf(transcriptPath).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const u = entry.message?.usage;
    const total =
      (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
    if (total > 0) return total;
  }
  return 0;
}

function loadMark(sessionId) {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, `${sessionId}.json`), "utf8")).mark ?? 0;
  } catch {
    return 0;
  }
}

function saveMark(sessionId, mark) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, `${sessionId}.json`), JSON.stringify({ mark }));
}

function markOf(context) {
  return context < FIRST ? 0 : FIRST + Math.floor((context - FIRST) / STEP) * STEP;
}

function nudge(context) {
  const k = Math.round(context / 1000);
  return (
    `Context is now ~${k}k tokens, and every further turn re-reads all of it. ` +
    "If the code for the current step is written and what comes next is a loop of checks " +
    "(repeated test runs, trace-and-fix debugging, engine checks, screenshots) or the wrap-up " +
    "(docs, review, merge), make a checkpoint before it: leave the working tree as it is " +
    "(no commit needed), write `.temp/handoff.md` at the root of the working tree — what is done, " +
    "what is left, the current hypotheses, what was already tried and ruled out, the files and " +
    "symbols that matter, the exact next " +
    "command — and end your turn with a final line `CHECKPOINT: .temp/handoff.md`. " +
    "A fresh session picks the work up from that note at a fraction of the cost. " +
    "If you are in the middle of a change that does not build yet, or the next step needs " +
    "what is loaded right now, carry on and checkpoint at the next stable point instead."
  );
}

const input = readInput();
if (input && !input.agent_id && input.session_id && input.transcript_path) {
  try {
    const context = contextOf(input.transcript_path);
    const mark = markOf(context);
    const last = loadMark(input.session_id);
    if (mark !== last) saveMark(input.session_id, mark);
    if (mark > last) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: nudge(context) },
        }),
      );
    }
  } catch {
    // A missing or unreadable transcript must never break the tool call.
  }
}
