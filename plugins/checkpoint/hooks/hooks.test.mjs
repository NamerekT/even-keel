import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The hooks as the agents run them: a script, the event's JSON on stdin, Even Keel on EVEN_KEEL_URL.
const HOOKS = dirname(fileURLToPath(import.meta.url));
const answers = new Map();
/** The bodies of the POST requests by URL, in order. */
const posted = new Map();
let server;
let url;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.method === "POST") {
      let text = "";
      for await (const chunk of request) text += chunk;
      posted.set(request.url, [...(posted.get(request.url) ?? []), JSON.parse(text)]);
    }
    const body = answers.get(request.url);
    if (body === undefined) response.writeHead(404).end();
    else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

function run(script, input, evenKeel = url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HOOKS, script)], { env: { ...process.env, EVEN_KEEL_URL: evenKeel } });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}

/** What each agent sends, as seen live (Claude Code 2.1, Codex 0.162.1). */
const agents = {
  claude: (session, event, extra) => ({
    session_id: session,
    transcript_path: "C:\\Users\\john\\.claude\\projects\\repo\\s.jsonl",
    cwd: "D:\\repo",
    permission_mode: "auto",
    hook_event_name: event,
    ...extra,
  }),
  codex: (session, event, extra) => ({
    session_id: session,
    turn_id: "turn-1",
    transcript_path: "C:\\Users\\john\\.codex\\sessions\\2026\\10\\18\\rollout.jsonl",
    cwd: "D:\\repo",
    hook_event_name: event,
    model: "gpt-6-luna",
    permission_mode: "bypassPermissions",
    ...extra,
  }),
};

const checkpoint = (context) => ({ project: "ABC", task: "ABC-1", handoffs: 0, first: 200_000, source: "default", context });
const sessions = [];
const sessionOf = () => {
  const id = randomUUID();
  sessions.push(id);
  return id;
};
afterAll(() => {
  for (const id of sessions) rmSync(join(tmpdir(), "claude-context-checkpoint", `${id}.json`), { force: true });
});

describe.each(Object.entries(agents))("hooks on %s input", (_agent, input) => {
  const toolUse = (session) => input(session, "PostToolUse", { tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: "ok" });
  const stop = (session, message) => input(session, "Stop", { stop_hook_active: false, last_assistant_message: message });

  it("nudges once the context Even Keel reads passes the threshold, and once per mark", async () => {
    const session = sessionOf();
    answers.set(`/api/sessions/${session}/checkpoint`, checkpoint(120_000));
    expect((await run("context-checkpoint.mjs", toolUse(session))).stdout).toBe("");
    answers.set(`/api/sessions/${session}/checkpoint`, checkpoint(205_000));
    const nudged = JSON.parse((await run("context-checkpoint.mjs", toolUse(session))).stdout);
    expect(nudged.hookSpecificOutput).toMatchObject({ hookEventName: "PostToolUse", additionalContext: expect.stringMatching(/~205k tokens/) });
    expect((await run("context-checkpoint.mjs", toolUse(session))).stdout).toBe("");
  });

  it("stays silent for a session Even Keel did not start, or whose context it does not know", async () => {
    const session = sessionOf();
    expect(await run("context-checkpoint.mjs", toolUse(session))).toEqual({ code: 0, stdout: "" });
    answers.set(`/api/sessions/${session}/checkpoint`, checkpoint(null));
    expect(await run("context-checkpoint.mjs", toolUse(session))).toEqual({ code: 0, stdout: "" });
  });

  it("sends a turn back that wrote the note but has no CHECKPOINT line", async () => {
    const session = sessionOf();
    answers.set(`/api/sessions/${session}/note`, { note: true });
    const blocked = JSON.parse((await run("checkpoint-mark.mjs", stop(session, "The note is ready."))).stdout);
    expect(blocked).toMatchObject({ decision: "block", reason: expect.stringMatching(/CHECKPOINT: \.temp\/handoff\.md/) });
    expect((await run("checkpoint-mark.mjs", stop(session, "Ready.\n\nCHECKPOINT: .temp/handoff.md"))).stdout).toBe("");
    expect((await run("checkpoint-mark.mjs", { ...stop(session, "Ready."), stop_hook_active: true })).stdout).toBe("");
  });

  it("lets a turn stop that wrote no note, and any turn without Even Keel", async () => {
    const session = sessionOf();
    expect(await run("checkpoint-mark.mjs", stop(session, "Done."))).toEqual({ code: 0, stdout: "" });
    answers.set(`/api/sessions/${session}/note`, { note: false });
    expect(await run("checkpoint-mark.mjs", stop(session, "Done."))).toEqual({ code: 0, stdout: "" });
  });

  it("puts a chat message into the context before or after a tool call and names the event", async () => {
    const session = sessionOf();
    const mail = `/api/sessions/${session}/mail`;
    answers.set(mail, { message: "Use the other parser." });
    const after = JSON.parse((await run("mailbox.mjs", toolUse(session))).stdout);
    expect(after).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "Use the other parser." } });
    const before = JSON.parse((await run("mailbox.mjs", input(session, "PreToolUse", { tool_name: "Read", tool_input: {} }))).stdout);
    expect(before).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "Use the other parser." } });
    expect(posted.get(mail)).toEqual([{ event: "PostToolUse" }, { event: "PreToolUse" }]);
  });

  it("keeps the turn going at a stop, even a stop a hook already held, and turns a question down", async () => {
    const session = sessionOf();
    const mail = `/api/sessions/${session}/mail`;
    answers.set(mail, { message: "One more thing." });
    expect(JSON.parse((await run("mailbox.mjs", stop(session, "Done."))).stdout)).toEqual({ decision: "block", reason: "One more thing." });
    expect(JSON.parse((await run("mailbox.mjs", { ...stop(session, "Done."), stop_hook_active: true })).stdout)).toMatchObject({ decision: "block" });
    const asked = JSON.parse((await run("mailbox.mjs", input(session, "PreToolUse", { tool_name: "AskUserQuestion", tool_input: {} }))).stdout);
    expect(asked).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "One more thing." },
    });
    expect(posted.get(mail).map((body) => body.event)).toEqual(["Stop", "Stop", "AskUserQuestion"]);
  });

  it("stays silent when nothing waits, without Even Keel, and in a subagent", async () => {
    const session = sessionOf();
    expect(await run("mailbox.mjs", toolUse(session))).toEqual({ code: 0, stdout: "" });
    answers.set(`/api/sessions/${session}/mail`, { message: null });
    expect(await run("mailbox.mjs", stop(session, "Done."))).toEqual({ code: 0, stdout: "" });
    answers.set(`/api/sessions/${session}/mail`, { message: "Later." });
    const before = posted.get(`/api/sessions/${session}/mail`).length;
    expect(await run("mailbox.mjs", { ...toolUse(session), agent_id: "agent-1" })).toEqual({ code: 0, stdout: "" });
    expect(posted.get(`/api/sessions/${session}/mail`)).toHaveLength(before);
  });
});

describe("the permission hook", () => {
  const request = (session, extra) => agents.claude(session, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm publish" }, ...extra });

  it("asks Even Keel every second until the user decides, and hands the decision to the CLI", async () => {
    const session = sessionOf();
    const permission = `/api/sessions/${session}/permission`;
    answers.set(permission, { decision: null });
    const hook = run("permission.mjs", request(session));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    answers.set(permission, { decision: { behavior: "deny", message: "Publish from CI." } });
    expect(JSON.parse((await hook).stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Publish from CI." } },
    });
    expect(posted.get(permission).length).toBeGreaterThanOrEqual(2);
    expect(posted.get(permission)[0]).toEqual({ tool: "Bash", input: { command: "npm publish" }, since: expect.any(Number) });
  });

  it("leaves the dialog alone for a session Even Keel did not start, for Codex and without Even Keel", async () => {
    const session = sessionOf();
    expect(await run("permission.mjs", request(session))).toEqual({ code: 0, stdout: "" });
    answers.set(`/api/sessions/${session}/permission`, { decision: { behavior: "allow" } });
    expect(await run("permission.mjs", request(session, { turn_id: "turn-1" }))).toEqual({ code: 0, stdout: "" });
    expect(await run("permission.mjs", request(session), "http://127.0.0.1:9")).toEqual({ code: 0, stdout: "" });
  });
});

// OpenCode's plugin as OpenCode calls it, in its own process: `tool.execute.after` with the call and its mutable output.
describe("the OpenCode plugin", () => {
  let after;
  let saved;
  beforeAll(async () => {
    saved = process.env.EVEN_KEEL_URL;
    process.env.EVEN_KEEL_URL = url;
    const { server } = await import("../opencode/checkpoint.mjs");
    after = (await server({}))["tool.execute.after"];
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.EVEN_KEEL_URL;
    else process.env.EVEN_KEEL_URL = saved;
  });

  /** What OpenCode 1.18.25 passes for a shell call, as seen live. */
  const call = async (session) => {
    const output = { title: "echo hello", output: "hello\n", metadata: { output: "hello\n", exit: 0, truncated: false } };
    await after({ tool: "bash", sessionID: session, callID: "call_1", args: { command: "echo hello" } }, output);
    return output;
  };

  it("puts the nudge after the tool's output once the context passes the threshold, once per mark", async () => {
    const session = sessionOf();
    answers.set(`/api/sessions/${session}/checkpoint`, checkpoint(120_000));
    expect((await call(session)).output).toBe("hello\n");
    answers.set(`/api/sessions/${session}/checkpoint`, checkpoint(205_000));
    const nudged = await call(session);
    expect(nudged.output).toMatch(/^hello\n\n\n<system-reminder>\nContext is now ~205k tokens[\s\S]*\n<\/system-reminder>$/);
    expect(nudged.metadata.evenKeel).toBeUndefined();
    expect((await call(session)).output).toBe("hello\n");
  });

  it("delivers the chat's message after the output and keeps it in the call's metadata", async () => {
    const session = sessionOf();
    const mail = `/api/sessions/${session}/mail`;
    answers.set(mail, { message: "Use the other parser." });
    const delivered = await call(session);
    expect(delivered.output).toBe("hello\n\n\n<system-reminder>\nUse the other parser.\n</system-reminder>");
    expect(delivered.metadata).toEqual({ output: "hello\n", exit: 0, truncated: false, evenKeel: { mail: "Use the other parser." } });
    expect(posted.get(mail)).toEqual([{ event: "PostToolUse" }]);
  });

  it("leaves the call alone for a session Even Keel did not start, when nothing waits, and without Even Keel", async () => {
    const session = sessionOf();
    expect(await call(session)).toEqual({ title: "echo hello", output: "hello\n", metadata: { output: "hello\n", exit: 0, truncated: false } });
    answers.set(`/api/sessions/${session}/mail`, { message: null });
    expect((await call(session)).output).toBe("hello\n");
    process.env.EVEN_KEEL_URL = "http://127.0.0.1:9";
    try {
      expect((await call(session)).output).toBe("hello\n");
    } finally {
      process.env.EVEN_KEEL_URL = url;
    }
  });
});
