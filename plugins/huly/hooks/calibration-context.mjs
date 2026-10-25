import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrationText, estimateCall, mismatch } from "./calibration.mjs";

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

/** Calibration shown once per session and project, including a refusal whose retry must pass. */
export async function calibrationContext(sessionId, toolName, args) {
  const call = estimateCall(toolName, args);
  if (call === null) return null;
  const mark = markOf(sessionId, call.project);
  if (mark !== null && existsSync(mark)) return null;
  const base = (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");
  const query = call.task === null ? "" : `?task=${encodeURIComponent(call.task)}`;
  const response = await fetch(`${base}/api/projects/${call.project}/calibration${query}`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return null;
  const answer = await response.json();
  if (answer?.state !== "ok" || calibrationText(answer.data) === null) return null;
  // Without a persisted mark a refusal would also block the retry.
  let refused = mark === null ? null : mismatch(answer.data, args.estimation);
  if (mark !== null) {
    try {
      remember(mark);
    } catch {
      refused = null;
    }
  }
  return { text: calibrationText(answer.data, refused), refused: refused !== null };
}
