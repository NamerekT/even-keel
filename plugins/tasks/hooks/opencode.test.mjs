import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../opencode/tasks.mjs";

const sessions = [];
const input = (tool = "task_update", sessionID = randomUUID(), callID = randomUUID()) => {
  sessions.push(sessionID);
  return { tool: `plugin_tasks_tasks_${tool}`, sessionID, callID };
};
const data = {
  project: "ABC", closed: 10, estimated: 10, thin: false, scope: "project", recent: [],
  steps: [5, 10, 20, 40, 80].map((minutes) => ({ minutes, closed: 10, thin: false, median: minutes === 40 ? 20 : minutes, low: 5, high: 20 })),
};
const answer = (value = { state: "ok", data }) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => value })));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const session of sessions.splice(0)) for (const project of ["ABC", "BTN"]) rmSync(join(tmpdir(), "even-keel-calibration", `${session}-${project}`), { force: true });
});

describe("tasks OpenCode hooks", () => {
  it("adds calibration to the matching result, once per session and project", async () => {
    answer();
    const hooks = await server({});
    const call = input();
    await hooks["tool.execute.before"](call, { args: { key: "ABC-12", estimate: 10 } });
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/projects\/ABC\/calibration\?task=ABC-12$/);
    const result = { output: "saved" };
    await hooks["tool.execute.after"](call, result);
    expect(result.output).toContain("saved\n\n<system-reminder>\nEstimate calibration, project ABC");
    await hooks["tool.execute.before"](input("tasks_create", call.sessionID), { args: { project: "ABC", tasks: [{ title: "x", estimate: 10 }] } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("takes a chain session's project from its worktree and refuses a mismatched estimate once", async () => {
    answer();
    const hooks = await server({ directory: join("repo", ".claude", "worktrees", "btn-7") });
    const call = input("tasks_create");
    const args = { tasks: [{ title: "x", estimate: 40 }] };
    await expect(hooks["tool.execute.before"](call, { args })).rejects.toThrow("This call was refused once");
    expect(fetch.mock.calls[0][0]).toMatch(/\/BTN\/calibration$/);
    await expect(hooks["tool.execute.before"](call, { args })).resolves.toBeUndefined();
  });

  it.each(["plugin_tasks_tasks_task_comment", "plugin_huly_huly_update_issue", "bash"])("leaves %s alone", async (tool) => {
    answer();
    const hooks = await server({});
    await hooks["tool.execute.before"]({ ...input(), tool }, { args: { key: "ABC-1", estimate: 40 } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets a call through when Even Keel does not answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const hooks = await server({});
    await expect(hooks["tool.execute.before"](input(), { args: { key: "ABC-1", estimate: 40 } })).resolves.toBeUndefined();
  });

  it("the command hook stays silent on a tool that sets no estimate", async () => {
    const session = randomUUID();
    sessions.push(session);
    const script = fileURLToPath(new URL("./show-calibration.mjs", import.meta.url));
    const command = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ session_id: session, tool_name: "mcp__plugin_tasks_tasks__task_comment", tool_input: { key: "ABC-1", estimate: 40 } }),
      encoding: "utf8",
    });
    expect(command.status).toBe(0);
    expect(command.stdout).toBe("");
  });
});
