// Whether a shell command sends a request to Even Keel's own address, and what a session is told when the project's
// Protection group "Even Keel's address" (`ownAddress`, BTN-1127) is on. The service lets a request from this machine
// through without the page's token, so a chain session under someone else's text could change Protection, answer for
// the user or write to another project's tasks. A pattern guardrail, not a sandbox: a script the session wrote, an
// address built in a string or the machine's own network address go past it.

const DEFAULT_URL = "http://127.0.0.1:4747";
const NETWORK_TOOLS = new Set(["curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "http", "https", "xh", "nc", "ncat", "telnet", "node", "python", "python3", "py", "deno", "bun"]);
const NETWORK_CALLS = /fetch\s*\(|webclient|httpclient|urllib|requests\.|http\.(get|request)\b|socket/i;
const URL_VARIABLE = /\bEVEN_KEEL_URL\b/;

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function serviceOf(url) {
  try {
    const parsed = new URL(url || DEFAULT_URL);
    return { host: parsed.hostname, port: parsed.port || (parsed.protocol === "https:" ? "443" : "80") };
  } catch {
    return serviceOf(DEFAULT_URL);
  }
}

/** The service's address in `text`: by a loopback name or the host Even Keel gives, with its port, or as `EVEN_KEEL_URL`. */
function namesAddress(text, url) {
  if (URL_VARIABLE.test(text)) return true;
  const { host, port } = serviceOf(url);
  const hosts = ["localhost", "127(?:\\.\\d{1,3}){3}", "\\[::1\\]", "0\\.0\\.0\\.0", escaped(host)];
  return new RegExp(`(?<![\\w.-])(?:${hosts.join("|")}):${port}(?!\\d)`, "i").test(text);
}

/** A network tool in the place of any word, by any path and as `.exe`, or a request made in code given to an interpreter. */
function usesNetwork(text) {
  if (NETWORK_CALLS.test(text)) return true;
  return text
    .split(/[\s;|&(){}`'"]+/)
    .map((word) => word.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, ""))
    .some((word) => NETWORK_TOOLS.has(word));
}

/**
 * `command` names the service's address (`url`, `EVEN_KEEL_URL` of the hook's process) and a network tool or call:
 * `grep 127.0.0.1:4747` or `echo $EVEN_KEEL_URL` alone is not a request.
 */
export function reachesService(command, url) {
  const text = String(command ?? "");
  return text !== "" && namesAddress(text, url) && usesNetwork(text);
}

export const ADDRESS_REFUSAL =
  "Even Keel: this call sends a request to Even Keel's own address, and the project's Protection turns that off, so it did not run. " +
  "A chain session works with its task through the tasks tools; do not retry it through a script or another spelling of the address. " +
  "If the task needs Even Keel's API, say so in your answer: the user can turn off the group \"Even Keel's address\" in the project's Protection.";

/**
 * The refusal text for `command`, or null: it does not reach the service, the project's group is off, or Even Keel
 * did not answer. `checkOf` asks Even Keel only for a command that reaches it.
 */
export async function addressRefusal(command, checkOf, url = process.env.EVEN_KEEL_URL) {
  if (!reachesService(command, url)) return null;
  const check = await Promise.resolve()
    .then(checkOf)
    .catch(() => null);
  return check?.ownAddress === true ? ADDRESS_REFUSAL : null;
}
