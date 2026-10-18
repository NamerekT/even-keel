#!/usr/bin/env node
// PostToolUse nudge: once the main thread's context passes the first threshold, again every
// step after that and every late step past the late threshold, tell the agent how big it is
// and ask for a checkpoint. The first nudge lets it pick the moment; the later ones do not,
// since sessions kept citing "the next step needs what is loaded". The context, the project's
// threshold and how many handoffs the task has had come from Even Keel, which reads the
// transcript of either agent (nudges.mjs); a session Even Keel did not start is left alone.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markOf, nudge, planOf } from "./nudges.mjs";

const BASE = (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");
const STATE_DIR = join(tmpdir(), "claude-context-checkpoint");

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
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

/** null — Even Keel did not start this session, or does not know its context yet. */
async function askEvenKeel(sessionId) {
  const url = `${BASE}/api/sessions/${encodeURIComponent(sessionId)}/checkpoint`;
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return null;
  const answer = await response.json();
  return typeof answer?.context === "number" ? answer : null;
}

async function main() {
  const input = readInput();
  if (!input || input.agent_id || !input.session_id) return;
  const answer = await askEvenKeel(input.session_id);
  if (answer === null) return;
  const plan = planOf(process.env, answer);
  const mark = markOf(answer.context, plan);
  const last = loadMark(input.session_id);
  if (mark !== last) saveMark(input.session_id, mark);
  if (mark > last) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: nudge(answer.context, last, plan) },
      }),
    );
  }
}

// No Even Keel, or no answer in time, must never break the tool call.
main().catch(() => {});
