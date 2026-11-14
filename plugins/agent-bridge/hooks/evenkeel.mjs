// What the hooks ask Even Keel about a session, shared by the hook commands of Claude Code, Codex and Copilot and by
// OpenCode's plugin (../opencode/agent-bridge.mjs): the checkpoint nudge due now, the chat's waiting messages, the
// check before a merge, the project's standards and whether the turn wrote the handoff note at its end.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noteIn } from "./handoff.mjs";
import { markOf, nudge, planOf } from "./nudges.mjs";

export const STATE_DIR = join(tmpdir(), "claude-context-checkpoint");

const base = () => (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");

/**
 * A hook's output that puts `text` into the model's context. Copilot drops `hookSpecificOutput.additionalContext` on
 * PostToolUse and takes a top-level `additionalContext` on every event; Even Keel marks its sessions with
 * EVEN_KEEL_AGENT. Claude Code and Codex get the shape of their own docs.
 */
export function contextOutput(hookEvent, text, env = process.env) {
  if (env.EVEN_KEEL_AGENT === "copilot") return { additionalContext: text };
  return { hookSpecificOutput: { hookEventName: hookEvent, additionalContext: text } };
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

/**
 * The project's check before the session merges its task branch, its standards (../hooks/standards.mjs) and the
 * project's main branch (`main` when Even Keel does not name one). No commands — Even Keel did not start this session,
 * the project has none, or a CI will judge main. `git: false` — the project's git is off (./gitban.mjs);
 * `ownAddress` — its Protection refuses requests to Even Keel's own address (./addressban.mjs).
 */
export async function checkOf(sessionId) {
  const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/check`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return { commands: [], standards: [], main: "main", git: true, ownAddress: false };
  const body = await response.json();
  const commands = Array.isArray(body?.commands) ? body.commands.filter((command) => typeof command === "string" && command.trim() !== "") : [];
  return { commands, standards: standardsIn(body), main: typeof body?.branch === "string" && body.branch !== "" ? body.branch : "main", git: body?.git !== false, ownAddress: body?.ownAddress === true };
}

/** Tells Even Keel the project's check before the merge passed on `tree` (EKR-103); a failure is the caller's to swallow. */
export async function reportCheck(sessionId, tree, commands) {
  await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tree, commands }),
    signal: AbortSignal.timeout(2000),
  });
}

function standardsIn(body) {
  if (!Array.isArray(body?.standards)) return [];
  return body.standards.filter((standard) => typeof standard?.doc === "string" && standard.doc !== "" && Array.isArray(standard.files));
}

/** The project's standards; empty — none, or Even Keel did not start this session. */
export async function standardsOf(sessionId) {
  const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/standards`, { signal: AbortSignal.timeout(2000) });
  return response.ok ? standardsIn(await response.json()) : [];
}

/**
 * The note the session's turn wrote among its last tool calls, as `.temp/handoff….md`, or null: none, or no Even Keel.
 * Even Keel reads the transcript of any agent; one before BTN-964 names no path, and its note is the shared one.
 */
export async function noteAtEnd(sessionId) {
  const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/note`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const answer = await response.json();
  return answer?.note === true ? noteIn(answer.path) : null;
}

/**
 * What Even Keel has for the session on `event`: `message` — the text of what waited in the chat, now delivered;
 * `context` — a note of Even Keel's own for the context at a tool call (the request for the README badge's status
 * line). Each null when there is none, both when Even Keel did not start the session.
 */
export async function hookMailOf(sessionId, event) {
  const response = await fetch(`${base()}/api/sessions/${encodeURIComponent(sessionId)}/mail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return { message: null, context: null };
  const body = await response.json();
  const text = (value) => (typeof value === "string" && value !== "" ? value : null);
  return { message: text(body?.message), context: text(body?.context) };
}

/** The text of what waited for the session, now delivered on `event`, or null: nothing waits, or Even Keel did not start it. */
export async function mailOf(sessionId, event) {
  return (await hookMailOf(sessionId, event)).message;
}
