#!/usr/bin/env node
// PostToolUse nudge: once the main thread's context passes the first threshold, again every
// step after that and every late step past the late threshold, tell the agent how big it is
// and ask for a checkpoint. The first nudge lets it pick the moment; the later ones do not,
// since sessions kept citing "the next step needs what is loaded". Even Keel, when it runs,
// gives the project's threshold and how many handoffs the task has had (nudges.mjs).
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askFrom, isDue, markOf, nudge, planOf } from "./nudges.mjs";

const BASE = (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");
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

function loadState(sessionId) {
  try {
    const state = JSON.parse(readFileSync(join(STATE_DIR, `${sessionId}.json`), "utf8"));
    return { ...state, mark: state.mark ?? 0 };
  } catch {
    return { mark: 0 };
  }
}

function saveState(sessionId, state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, `${sessionId}.json`), JSON.stringify(state));
}

/** null — Even Keel runs but did not start this session. */
async function askEvenKeel(sessionId) {
  const url = `${BASE}/api/sessions/${encodeURIComponent(sessionId)}/checkpoint`;
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return await response.json();
}

async function main() {
  const input = readInput();
  if (!input || input.agent_id || !input.session_id || !input.transcript_path) return;
  const context = contextOf(input.transcript_path);
  const state = loadState(input.session_id);
  let changed = false;
  if (context >= askFrom(process.env) && isDue(state, Date.now())) {
    try {
      state.answer = await askEvenKeel(input.session_id);
      state.ok = true;
    } catch {
      state.ok = false;
    }
    state.askedAt = Date.now();
    changed = true;
  }
  const plan = planOf(process.env, state.answer ?? null);
  const mark = markOf(context, plan);
  const last = state.mark;
  if (mark !== last) {
    state.mark = mark;
    changed = true;
  }
  if (changed) saveState(input.session_id, state);
  if (mark > last) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: nudge(context, last, plan) },
      }),
    );
  }
}

// A missing or unreadable transcript must never break the tool call.
main().catch(() => {});
