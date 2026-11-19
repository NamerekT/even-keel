#!/usr/bin/env node
// The session's inbox: at each start of a Claude Code process (a launch, a resume, a clear or a compaction) the CLI
// gives its hooks the address of the session's inbox socket and its token. Even Keel writes the user's chat messages
// there, so they reach the session at once, mid-turn or while it waits on a background command. Prints nothing.
import { readFileSync } from "node:fs";
import { reportInbox } from "./evenkeel.mjs";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!socket || !token) return;
  const input = readInput();
  if (!input || input.agent_id || !input.session_id || input.hook_event_name !== "SessionStart") return;
  await reportInbox(input.session_id, socket, token);
}

// No Even Keel, or no answer in time, must never hold the session's start.
main().catch(() => {});
