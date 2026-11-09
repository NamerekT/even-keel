import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_URL = "http://127.0.0.1:4748/tasks";

/** The tasks server's address from the plugin's `.mcp.json`, which the user may have pointed at another port. */
export function tasksUrl(pluginRoot) {
  try {
    const url = JSON.parse(readFileSync(join(pluginRoot, ".mcp.json"), "utf8"))?.mcpServers?.tasks?.url;
    return typeof url === "string" && url !== "" ? url : DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

/**
 * Why the tasks tools are missing in a session started by hand, or `null` while Even Keel's service answers (BTN-874).
 * A chain session (`EVEN_KEEL_URL` set) is run by the service itself and is not asked about. Any HTTP answer counts:
 * only a refused or silent connection means the service is down.
 */
export async function serviceNotice(env, pluginRoot, fetchImpl = fetch) {
  if (env.EVEN_KEEL_URL) return null;
  const url = tasksUrl(pluginRoot);
  try {
    await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(2000) });
    return null;
  } catch {
    return (
      `Even Keel's service does not answer at ${url}: it is not running or is restarting, so the tasks server's tools ` +
      "(tasks_list, task_read, tasks_create, task_update, task_comment) are missing in this session. " +
      "Start the service or wait for its restart, then reconnect the server with /mcp."
    );
  }
}
