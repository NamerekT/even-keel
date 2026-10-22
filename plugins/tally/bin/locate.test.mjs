import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutAbove, findCheckout } from "./locate.mjs";

const root = join("/", "repos", "even-keel");
const tally = (dir) => [join(dir, "tally", "bin", "sql.mjs"), join(dir, "tally", "tally.config.json")];
const only = (...dirs) => (path) => dirs.some((dir) => tally(dir).includes(path));

describe("checkoutAbove", () => {
  it("finds the checkout that holds a copy of the plugin in its state folder", () => {
    const here = join(root, "state", "packages", "tally@even-keel", "abc123", "plugin", "bin");
    expect(checkoutAbove(here, only(root))).toBe(root);
  });

  it("finds the checkout the plugin's source lives in", () => {
    expect(checkoutAbove(join(root, "plugins", "tally", "bin"), only(root))).toBe(root);
  });

  it("does not take the plugin's own launcher for Tally's script", () => {
    const plugins = join(root, "plugins");
    const ownLauncher = (path) => path === join(plugins, "tally", "bin", "sql.mjs") || only(root)(path);
    expect(checkoutAbove(join(plugins, "tally", "bin"), ownLauncher)).toBe(root);
  });

  it("gives null when no folder above has Tally", () => {
    expect(checkoutAbove(join("/", "home", "user", ".claude", "plugins", "cache", "tally", "bin"), only(root))).toBeNull();
  });
});

describe("findCheckout", () => {
  const nowhere = join("/", "cache", "tally", "bin");
  const noState = async () => {
    throw new Error("Even Keel is not asked");
  };

  it("takes EVEN_KEEL_HOME first", async () => {
    const other = join("/", "elsewhere", "even-keel");
    const found = await findCheckout({ env: { EVEN_KEEL_HOME: other }, here: join(root, "plugins", "tally", "bin"), exists: only(root, other), fetchState: noState });
    expect(found).toBe(other);
  });

  it("refuses an EVEN_KEEL_HOME without Tally rather than guessing", async () => {
    const found = findCheckout({ env: { EVEN_KEEL_HOME: "/nope" }, here: join(root, "plugins", "tally", "bin"), exists: only(root), fetchState: noState });
    await expect(found).rejects.toThrow(/EVEN_KEEL_HOME/);
  });

  it("asks the running Even Keel for its checkout when nothing above has Tally", async () => {
    const asked = [];
    const fetchState = async (url) => {
      asked.push(url);
      return { packages: { marketplace: { name: "even-keel", dir: root, known: true } } };
    };
    const found = await findCheckout({ env: { EVEN_KEEL_URL: "http://127.0.0.1:5000/" }, here: nowhere, exists: only(root), fetchState });
    expect(found).toBe(root);
    expect(asked).toEqual(["http://127.0.0.1:5000/api/state"]);
  });

  it("names both ways out when Even Keel does not answer", async () => {
    const fetchState = async () => {
      throw new Error("ECONNREFUSED");
    };
    const found = findCheckout({ env: {}, here: nowhere, exists: only(root), fetchState });
    await expect(found).rejects.toThrow(/EVEN_KEEL_HOME.*127\.0\.0\.1:4747/s);
  });
});
