import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../opencode/huly.mjs";

const sessions = [];
const input = (tool = "update_issue", sessionID = randomUUID(), callID = randomUUID()) => {
  sessions.push(sessionID);
  return { tool: `plugin_huly_huly_${tool}`, sessionID, callID };
};
const data = {
  project: "ABC", closed: 10, estimated: 10, thin: false, scope: "project", recent: [],
  steps: [5, 10, 20, 40, 80].map((minutes) => ({
    minutes, closed: 10, thin: false, median: minutes === 40 ? 20 : minutes, low: 5, high: 20,
  })),
};
const answer = (value = { state: "ok", data }) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => value })));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const session of sessions.splice(0)) rmSync(join(tmpdir(), "even-keel-calibration", `${session}-ABC`), { force: true });
});

describe("Huly OpenCode hooks", () => {
  it.each(["create_issue", "update_issue", "add_comment"])("refuses %s with the same reason as the command hook", async (tool) => {
    const hooks = await server({});
    const args = { project: "ABC", description: "**see `Core`**", nested: { body: "~~use `Old`~~" } };
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("./check-marks.mjs", import.meta.url))], {
      input: JSON.stringify({ tool_input: args }), encoding: "utf8",
    });
    const reason = JSON.parse(command.stdout).hookSpecificOutput.permissionDecisionReason;
    await expect(hooks["tool.execute.before"](input(tool), { args })).rejects.toThrow(reason);
  });

  it("lets clean markdown through", async () => {
    const hooks = await server({});
    await expect(hooks["tool.execute.before"](input(), { args: { description: "**see** `Core`" } })).resolves.toBeUndefined();
  });

  it.each(["plugin_linear_linear_update_issue", "plugin_huly_huly_get_issue", "bash"])("leaves %s alone", async (tool) => {
    answer();
    const hooks = await server({});
    await hooks["tool.execute.before"]({ ...input(), tool }, { args: { description: "**see `Core`**", project: "ABC", estimation: 0.67 } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds calibration only to the matching result, once per session and project", async () => {
    answer();
    const hooks = await server({});
    const call = input();
    await hooks["tool.execute.before"](call, { args: { project: "ABC", identifier: "ABC-12", estimation: 0.17 } });
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/projects\/ABC\/calibration\?task=ABC-12$/);
    const other = { output: "other" };
    await hooks["tool.execute.after"]({ ...call, callID: "another" }, other);
    expect(other.output).toBe("other");
    const result = { output: "saved" };
    await hooks["tool.execute.after"](call, result);
    expect(result.output).toContain("saved\n\n<system-reminder>");
    expect(result.output).toContain("Estimate calibration, project ABC");
    await hooks["tool.execute.before"](input("create_issue", call.sessionID), { args: { project: "ABC", estimation: 0.17 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    await hooks["tool.execute.before"](input("create_issue"), { args: { project: "ABC", estimation: 0.17 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses a mismatched estimate once, including across plugin instances", async () => {
    answer();
    const call = input("create_issue");
    const args = { project: "ABC", estimation: 0.67 };
    await expect((await server({}))["tool.execute.before"](call, { args })).rejects.toThrow("This call was refused once");
    expect(fetch.mock.calls[0][0]).toMatch(/\/ABC\/calibration$/);
    await expect((await server({}))["tool.execute.before"](call, { args })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adds calibration to the raw MCP content OpenCode passes to the after hook", async () => {
    answer();
    const hooks = await server({});
    const call = input();
    await hooks["tool.execute.before"](call, { args: { project: "ABC", estimation: 0.17 } });
    const result = { content: [{ type: "text", text: "saved" }], isError: false };
    await hooks["tool.execute.after"](call, result);
    expect(result.content[0]).toEqual({ type: "text", text: "saved" });
    expect(result.content[1]).toEqual({ type: "text", text: expect.stringContaining("Estimate calibration, project ABC") });
    await hooks["tool.execute.after"](call, result);
    expect(result.content).toHaveLength(2);
  });

  it("checks marks before showing calibration", async () => {
    answer();
    const hooks = await server({});
    await expect(hooks["tool.execute.before"](input(), {
      args: { project: "ABC", estimation: 0.67, description: "**see `Core`**" },
    })).rejects.toThrow("Not sent");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets a call through when Even Keel does not answer, and retries calibration later", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const hooks = await server({});
    const call = input();
    const args = { project: "ABC", estimation: 0.17 };
    await expect(hooks["tool.execute.before"](call, { args })).resolves.toBeUndefined();
    answer();
    await hooks["tool.execute.before"](call, { args });
    const result = { output: "saved" };
    await hooks["tool.execute.after"](call, result);
    expect(result.output).toContain("Estimate calibration");
  });

  it.each([{ state: "off" }, { state: "ok", data: { ...data, closed: 0 } }])("stays silent without calibration data: %j", async (value) => {
    answer(value);
    const hooks = await server({});
    const call = input();
    await hooks["tool.execute.before"](call, { args: { project: "ABC", estimation: 0.67 } });
    const result = { output: "saved" };
    await hooks["tool.execute.after"](call, result);
    expect(result.output).toBe("saved");
  });
});
