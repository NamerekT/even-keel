#!/usr/bin/env node
// A tool call Claude Code wants approved in a chain session: while the CLI shows its dialog, the hook asks Even Keel
// every second for the user's decision from the page and hands it to the CLI, which takes it without a stop. A
// session Even Keel did not start, no Even Keel, or no decision before the deadline leave the dialog to Remote Control.
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { decisionOf } from "./evenkeel.mjs";

const POLL_MS = 1000;
/** Its dialog is the question itself: the page shows and answers it as one, not as a call to approve. */
const ASK_TOOL = "AskUserQuestion";
/** A minute under the hook's timeout in hooks.json, so that the hook ends on its own. */
const DEADLINE_MS = 29 * 60_000;

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Once Even Keel has answered, a request that fails is its restart: the hook asks on. Before that it gives up at once.
 * Codex, whose input carries `turn_id`, has the same hook, but its approvals are its reviewer's, so they are left alone.
 */
async function main() {
  const input = readInput();
  if (!input?.session_id || input.turn_id || input.hook_event_name !== "PermissionRequest" || !input.tool_name || input.tool_name === ASK_TOOL) return;
  const since = Date.now();
  let heard = false;
  while (Date.now() < since + DEADLINE_MS) {
    let decision;
    try {
      decision = await decisionOf(input.session_id, input.tool_name, input.tool_input ?? {}, since);
    } catch (error) {
      if (!heard) throw error;
    }
    if (decision === null) return;
    heard = true;
    if (decision !== undefined) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }));
      return;
    }
    await delay(POLL_MS);
  }
}

main().catch(() => {});
