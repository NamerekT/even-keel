#!/usr/bin/env node
// The chat mailbox: a message the user wrote from Even Keel's chat to a working session waits in Even Keel
// until this hook takes it. Before or after a tool call it goes into the context; at a stop it keeps the turn
// going; before AskUserQuestion it turns the question down, so that the question does not hang next to an
// unread message. Subagents are left alone: the message waits for the main thread.
import { readFileSync } from "node:fs";

const BASE = (process.env.EVEN_KEEL_URL || "http://127.0.0.1:4747").replace(/\/+$/, "");

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** The text of what waited for the session, or null: nothing waits, or Even Keel did not start it. */
async function mailOf(sessionId, event) {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/mail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(event === "Stop" ? 5000 : 2000),
  });
  if (!response.ok) return null;
  const message = (await response.json())?.message;
  return typeof message === "string" && message !== "" ? message : null;
}

function outputOf(hookEvent, event, message) {
  if (hookEvent === "Stop") return { decision: "block", reason: message };
  if (event === "AskUserQuestion") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } };
  }
  return { hookSpecificOutput: { hookEventName: hookEvent, additionalContext: message } };
}

async function main() {
  const input = readInput();
  if (!input || input.agent_id || !input.session_id) return;
  const hookEvent = input.hook_event_name;
  if (hookEvent !== "PreToolUse" && hookEvent !== "PostToolUse" && hookEvent !== "Stop") return;
  const event = hookEvent === "PreToolUse" && input.tool_name === "AskUserQuestion" ? "AskUserQuestion" : hookEvent;
  const message = await mailOf(input.session_id, event);
  if (message !== null) process.stdout.write(JSON.stringify(outputOf(hookEvent, event, message)));
}

// No Even Keel, or no answer in time, must never break the tool call or keep the session from stopping.
main().catch(() => {});
