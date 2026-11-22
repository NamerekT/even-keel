#!/usr/bin/env node
// The chat mailbox: a message the user wrote from Even Keel's chat to a working session waits in Even Keel
// until this hook takes it. Before or after a tool call it goes into the context; at a stop it keeps the turn
// going; before AskUserQuestion it turns the question down, so that the question does not hang next to an
// unread message. Subagents are left alone: the message waits for the main thread. When Even Keel restarted since
// the session's start and asks for the session's inbox, the hook tells it again, as inbox.mjs does at a start.
import { readFileSync } from "node:fs";
import { contextOutput, hookMailOf, reportInbox } from "./evenkeel.mjs";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function outputOf(hookEvent, event, message) {
  if (hookEvent === "Stop") return { decision: "block", reason: message };
  if (event === "AskUserQuestion") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } };
  }
  return contextOutput(hookEvent, message);
}

async function main() {
  const input = readInput();
  if (!input || input.agent_id || !input.session_id) return;
  const hookEvent = input.hook_event_name;
  if (hookEvent !== "PreToolUse" && hookEvent !== "PostToolUse" && hookEvent !== "Stop") return;
  const event = hookEvent === "PreToolUse" && input.tool_name === "AskUserQuestion" ? "AskUserQuestion" : hookEvent;
  const { message, context, inbox } = await hookMailOf(input.session_id, event);
  // Even Keel's own note rides only with a tool call's context: it must neither keep a turn going nor turn a question down.
  const note = hookEvent === "Stop" || event === "AskUserQuestion" ? null : context;
  const text = [message, note].filter((each) => each !== null).join("\n\n");
  if (text !== "") process.stdout.write(JSON.stringify(outputOf(hookEvent, event, text)));
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (inbox && socket && token) await reportInbox(input.session_id, socket, token).catch(() => {});
}

// No Even Keel, or no answer in time, must never break the tool call or keep the session from stopping.
main().catch(() => {});
