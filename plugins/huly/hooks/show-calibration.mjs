#!/usr/bin/env node
// PreToolUse on Huly calls that set an estimate: adds the project's estimate calibration from Even Keel
// to the agent's context, once per session and project. When the step sent disagrees with the data, that one
// call is refused with the calibration instead, and the retry goes through. No Even Keel, no statistics, no data — silent.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrationText, estimateCall, mismatch } from "./calibration.mjs";

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
  if (answer?.state !== "ok" || calibrationText(answer.data) === null) return;
  // A refusal without a mark would refuse the retry too, and the agent could never set the estimate.
  let refused = mark === null ? null : mismatch(answer.data, input.tool_input.estimation);
  if (mark !== null) {
    try {
      remember(mark);
    } catch {
      refused = null;
    }
  }
  const text = calibrationText(answer.data, refused);
  const output = refused
    ? { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: text }
    : { hookEventName: "PreToolUse", additionalContext: text };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: output }));
}

main().catch(() => {});
