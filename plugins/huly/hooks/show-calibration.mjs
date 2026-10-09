#!/usr/bin/env node
// PreToolUse on Huly calls that set an estimate: adds the project's estimate calibration from Even Keel
// to the agent's context, once per session and project. No Even Keel, no statistics, no data — silent.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrationText, estimateCall } from "./calibration.mjs";

const BASE = (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");
const MARKS = join(tmpdir(), "even-keel-calibration");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function markOf(sessionId, project) {
  return typeof sessionId === "string" && /^[\w-]+$/.test(sessionId) ? join(MARKS, `${sessionId}-${project}`) : null;
}

function remember(mark) {
  mkdirSync(MARKS, { recursive: true });
  writeFileSync(mark, "");
  for (const name of readdirSync(MARKS)) {
    const path = join(MARKS, name);
    if (Date.now() - statSync(path).mtimeMs > WEEK_MS) rmSync(path, { force: true });
  }
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const call = estimateCall(input.tool_name, input.tool_input);
  if (call === null) return;
  const mark = markOf(input.session_id, call.project);
  if (mark !== null && existsSync(mark)) return;
  const query = call.task === null ? "" : `?task=${encodeURIComponent(call.task)}`;
  const response = await fetch(`${BASE}/api/projects/${call.project}/calibration${query}`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return;
  const answer = await response.json();
  const text = answer?.state === "ok" ? calibrationText(answer.data) : null;
  if (text === null) return;
  if (mark !== null) {
    try {
      remember(mark);
    } catch {}
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } }));
}

main().catch(() => {});
