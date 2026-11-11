#!/usr/bin/env node
// PostToolUseFailure on MCP tools: Claude Code defers MCP tools, and a session that calls one before loading its
// schema through ToolSearch sends every argument as a string. Strings pass; a number, a boolean or a list fails the
// server's validation ("Invalid parameters for update_issue: estimation: Expected PositiveTimeHours"), and sessions
// took that for a server bug and dropped the field. This hook names the cause and the fix; it never blocks and says
// nothing on any other failure. Only Claude Code defers tools: Codex skips the event, the others never get the error.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { contextOutput } from "./evenkeel.mjs";

const VALIDATION = /Invalid parameters|InputValidationError|\bExpected\b/;

/** The arguments that hold a typed value as a string: `"0.17"`, `"false"`, `'["Bug"]'`. */
function stringified(input) {
  if (input === null || typeof input !== "object") return [];
  return Object.entries(input).filter(([, value]) => {
    if (typeof value !== "string") return false;
    try {
      return typeof JSON.parse(value) !== "string";
    } catch {
      return false;
    }
  });
}

/** The text for the agent's context, or null when the failure is not a call made without the tool's schema. */
export function schemaHint(input) {
  if (input?.hook_event_name !== "PostToolUseFailure") return null;
  const tool = input.tool_name;
  if (typeof tool !== "string" || !tool.startsWith("mcp__")) return null;
  if (typeof input.error !== "string" || !VALIDATION.test(input.error)) return null;
  const strings = stringified(input.tool_input);
  if (strings.length === 0) return null;
  const sent = strings.map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join(", ");
  return (
    `The schema of \`${tool}\` is not loaded, so its arguments went as strings (${sent}) and the server refused them. ` +
    `It is not a server or hook bug: load the schema with ToolSearch, query \`select:${tool}\`, ` +
    `then repeat the call with the same arguments as numbers, booleans or lists. Do not drop the field.`
  );
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const hint = schemaHint(input);
  if (hint !== null) process.stdout.write(JSON.stringify(contextOutput("PostToolUseFailure", hint)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
