#!/usr/bin/env node
// SessionStart: a session started by hand whose Even Keel service is down gets a plain reason for the missing tasks
// tools, for the user and the agent, instead of a bare failed connection. Silent when the service answers.
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { serviceNotice } from "./service-check.mjs";

async function main() {
  const root = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
  const notice = await serviceNotice(process.env, root);
  if (notice === null) return;
  process.stdout.write(JSON.stringify({ systemMessage: notice, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: notice } }));
}

main().catch(() => {});
