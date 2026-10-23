// What the hooks ask Even Keel about a session, shared by the hook commands of Claude Code and Codex and by
// OpenCode's plugin (../opencode/checkpoint.mjs): the checkpoint nudge due now, and the chat's waiting messages.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markOf, nudge, planOf } from "./nudges.mjs";

const STATE_DIR = join(tmpdir(), "claude-context-checkpoint");

const base = () => (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");

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
async function askCheckpoint(sessionId) {
  const url = `${base()}/api/sessions/${encodeURIComponent(sessionId)}/checkpoint`;
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return null;
  const answer = await response.json();
  return typeof answer?.context === "number" ? answer : null;
}

/**
 * The nudge due after this tool call, or null: none is due, or Even Keel did not start the session. The mark of the
 * last nudge is kept per session in `claude-context-checkpoint/` under the system temp folder.
 */
export async function checkpointNote(sessionId, env = process.env) {
  const answer = await askCheckpoint(sessionId);
  if (answer === null) return null;
  const plan = planOf(env, answer);
  const mark = markOf(answer.context, plan);
  const last = loadMark(sessionId);
  if (mark !== last) saveMark(sessionId, mark);
  return mark > last ? nudge(answer.context, last, plan) : null;
}

/**
 * The user's decision on a tool call the session waits to have approved: `{ behavior: "allow" }` or
 * `{ behavior: "deny", message }`; undefined — not yet; null — Even Keel did not start the session, or the dialog
 * the hook started at `since` (ms) was answered elsewhere.
 */
export async function decisionOf(sessionId, tool, input, since) {
  const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/permission`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, input, since }),
    signal: AbortSignal.timeout(2000),
  });
  if (response.status === 404) return null;
  if (!response.ok) return undefined;
  return (await response.json())?.decision ?? undefined;
}

/** The text of what waited for the session, now delivered on `event`, or null: nothing waits, or Even Keel did not start it. */
export async function mailOf(sessionId, event) {
  const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/mail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(event === "Stop" ? 5000 : 2000),
  });
  if (!response.ok) return null;
  const message = (await response.json())?.message;
  return typeof message === "string" && message !== "" ? message : null;
}
