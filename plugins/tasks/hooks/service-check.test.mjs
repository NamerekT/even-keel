import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceNotice, tasksUrl } from "./service-check.mjs";

const roots = [];
const root = (url) => {
  const dir = mkdtempSync(join(tmpdir(), "tasks-plugin-"));
  roots.push(dir);
  if (url !== undefined) writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { tasks: { type: "http", url } } }));
  return dir;
};

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("tasks plugin service check", () => {
  it("reads the address from the plugin's .mcp.json, the default without one", () => {
    expect(tasksUrl(root("http://127.0.0.1:5858/tasks"))).toBe("http://127.0.0.1:5858/tasks");
    expect(tasksUrl(root())).toBe("http://127.0.0.1:4748/tasks");
  });

  it("names the address and the way out when the connection is refused", async () => {
    const refused = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const notice = await serviceNotice({}, root("http://127.0.0.1:5858/tasks"), refused);
    expect(notice).toContain("http://127.0.0.1:5858/tasks");
    expect(notice).toContain("not running or is restarting");
    expect(notice).toContain("/mcp");
  });

  it("is silent while the service answers anything, and in a chain session", async () => {
    const answers = vi.fn(async () => ({ ok: false, status: 405 }));
    expect(await serviceNotice({}, root(), answers)).toBeNull();
    const never = vi.fn();
    expect(await serviceNotice({ EVEN_KEEL_URL: "http://127.0.0.1:4747" }, root(), never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});
