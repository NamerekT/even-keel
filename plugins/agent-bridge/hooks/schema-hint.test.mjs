import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { schemaHint } from "./schema-hint.mjs";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const TOOL = "mcp__plugin_huly_huly__update_issue";

/** A failed MCP call as Claude Code 2.1.314 hands it to PostToolUseFailure; the error is the server's own text. */
const failure = (extra) => ({
  session_id: "s-1",
  transcript_path: "C:\\Users\\john\\.claude\\projects\\repo\\s.jsonl",
  cwd: "D:\\repo",
  hook_event_name: "PostToolUseFailure",
  tool_name: TOOL,
  tool_input: { project: "ABC", identifier: "ABC-12", estimation: "0.17" },
  tool_use_id: "toolu_1",
  error: "Invalid parameters for update_issue: estimation: Expected PositiveTimeHours | null | undefined",
  ...extra,
});

function run(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HOOKS, "schema-hint.mjs")], { env: { ...process.env, EVEN_KEEL_AGENT: undefined } });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

describe("the schema hint", () => {
  it("tells a session that sent a typed argument as a string to load the tool's schema and repeat the call", () => {
    const hint = schemaHint(failure());
    expect(hint).toContain(`select:${TOOL}`);
    expect(hint).toContain('estimation: "0.17"');
    expect(hint).toContain("same arguments");
  });

  it("names every argument that went as a string, booleans and lists too, and leaves real strings out", () => {
    const hint = schemaHint(failure({
      tool_input: { project: "ABC", title: "Fix", dueDate: "1719792000000", archived: "false", labels: '["Bug"]' },
      error: "Error: Invalid parameters for create_issue: dueDate: Expected Timestamp",
    }));
    expect(hint).toContain('dueDate: "1719792000000"');
    expect(hint).toContain('archived: "false"');
    expect(hint).toContain('labels: "[\\"Bug\\"]"');
    expect(hint).not.toContain("title");
    expect(hint).not.toContain("project");
  });

  it("stays silent on a wrong value sent with its type, on other errors, other tools and other events", () => {
    expect(schemaHint(failure({ tool_input: { project: "ABC", identifier: "ABC-12", estimation: -1 } }))).toBeNull();
    expect(schemaHint(failure({ error: "Issue ABC-12 not found" }))).toBeNull();
    expect(schemaHint(failure({ tool_name: "Bash", tool_input: { command: "echo", timeout: "100" } }))).toBeNull();
    expect(schemaHint(failure({ hook_event_name: "PostToolUse" }))).toBeNull();
    expect(schemaHint(failure({ tool_input: undefined }))).toBeNull();
    expect(schemaHint(failure({ error: undefined }))).toBeNull();
  });

  it("puts the hint into the context through the hook's output, and stays silent on a successful call or bad input", async () => {
    const { code, stdout } = await run(failure());
    expect(code).toBe(0);
    const output = JSON.parse(stdout).hookSpecificOutput;
    expect(output.hookEventName).toBe("PostToolUseFailure");
    expect(output.additionalContext).toContain(`select:${TOOL}`);
    expect((await run({ ...failure(), hook_event_name: "PostToolUse", error: undefined, tool_response: [] })).stdout).toBe("");
    expect(await run("not json")).toEqual({ code: 0, stdout: "" });
  });
});
