import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The CLI refuses a plugin whose manifest does not parse, and a package update copies these files as they are.
const plugins = dirname(fileURLToPath(import.meta.url));
const root = dirname(plugins);

function jsonFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : jsonFiles(path);
    return entry.name.endsWith(".json") ? [path] : [];
  });
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const files = [join(root, ".claude-plugin", "marketplace.json"), ...jsonFiles(plugins)];

describe("the plugins' JSON files", () => {
  it.each(files.map((path) => [relative(root, path), path]))("%s parses", (_, path) => {
    expect(() => read(path)).not.toThrow();
  });

  const listed = read(join(root, ".claude-plugin", "marketplace.json")).plugins;
  it.each(listed.map((entry) => [entry.name, entry]))("%s has a manifest with its name and a version", (name, entry) => {
    const manifest = read(join(root, entry.source, ".claude-plugin", "plugin.json"));
    expect(manifest.name).toBe(name);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
