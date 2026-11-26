import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFLICTS_FILE, conflictsFor, SAVED_FILE } from "./memory-conflicts.mjs";

const HOOKS = dirname(fileURLToPath(import.meta.url));
let root;
let folder;
let marks;

const hashOf = (text) => createHash("sha256").update(text).digest("hex");
const KEPT = "---\nname: tone\n---\n\nNewer.\n";

function conflict(file, kept = KEPT) {
  writeFileSync(join(folder, file), kept);
  return { file, commit: "c1", other: "c0", since: "2026-11-24T20:46:00Z", hash: hashOf(kept), otherText: "Older.\n", note: `merge ${file}` };
}

function listConflicts(...conflicts) {
  mkdirSync(join(folder, ".git"), { recursive: true });
  writeFileSync(join(folder, CONFLICTS_FILE), JSON.stringify({ conflicts }));
}

const touch = (file, session = "s-1", event = "PostToolUse", tool = "Read") => ({
  session_id: session,
  cwd: root,
  hook_event_name: event,
  tool_name: tool,
  tool_input: { file_path: join(folder, file) },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "even-keel-memory-hook-"));
  folder = join(root, "memory");
  marks = join(root, "marks");
  mkdirSync(folder);
  writeFileSync(join(folder, "other.md"), "Other record.\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the memory conflicts hook", () => {
  it("gives every open conflict at the first touch of the folder, then one again when its own file is touched", () => {
    listConflicts(conflict("tone.md"), conflict("pace.md"));
    expect(conflictsFor(touch("other.md"), marks)).toBe("merge tone.md\n\nmerge pace.md");
    expect(conflictsFor(touch("other.md"), marks)).toBeNull();
    expect(conflictsFor(touch("pace.md", "s-1", "PreToolUse", "Edit"), marks)).toBe("merge pace.md");
    expect(conflictsFor(touch("other.md", "s-2"), marks)).toBe("merge tone.md\n\nmerge pace.md");
  });

  it("says nothing of a record saved after the conflict, of a folder without conflicts or of a call without a file", () => {
    listConflicts(conflict("tone.md"));
    writeFileSync(join(folder, "tone.md"), "Merged.\n");
    expect(conflictsFor(touch("tone.md"), marks)).toBeNull();
    rmSync(join(folder, CONFLICTS_FILE));
    expect(conflictsFor(touch("tone.md"), marks)).toBeNull();
    expect(conflictsFor({ session_id: "s-1", tool_input: { command: "ls" } }, marks)).toBeNull();
  });

  it("finds the global configuration's conflicts for a skill file opened through a link, and leaves a person's ones out (BTN-1690)", () => {
    const skill = join(folder, "skills", "review");
    mkdirSync(skill, { recursive: true });
    mkdirSync(join(folder, "hooks"));
    listConflicts(conflict(join("skills", "review", "SKILL.md").replace(/\\/g, "/")), { ...conflict("hooks/guard.mjs"), human: true });
    const linked = join(root, "home", ".claude", "skills", "review");
    mkdirSync(dirname(linked), { recursive: true });
    symlinkSync(skill, linked, process.platform === "win32" ? "junction" : "dir");
    const through = (file, session) => ({ ...touch("x", session), tool_input: { file_path: join(linked, file) } });
    expect(conflictsFor(through("SKILL.md", "s-1"), marks)).toBe("merge skills/review/SKILL.md");
    expect(conflictsFor(through("SKILL.md", "s-1"), marks)).toBe("merge skills/review/SKILL.md");
    expect(conflictsFor(through("new.md", "s-2"), marks)).toBe("merge skills/review/SKILL.md");
  });

  it("marks a conflict saved when a session saves its file unchanged, and tells of it no more (BTN-1746)", () => {
    listConflicts(conflict("tone.md"), conflict("pace.md"), { ...conflict("guard.mjs"), human: true });
    expect(conflictsFor(touch("tone.md", "s-1", "PostToolUse", "Write"), marks)).toBeNull();
    expect(JSON.parse(readFileSync(join(folder, SAVED_FILE), "utf8"))).toEqual({ saved: [{ file: "tone.md", hash: hashOf(KEPT) }] });
    expect(conflictsFor(touch("other.md", "s-2"), marks)).toBe("merge pace.md");
    conflictsFor(touch("tone.md", "s-1", "PostToolUse", "Edit"), marks);
    conflictsFor(touch("guard.mjs", "s-1", "PostToolUse", "Write"), marks);
    writeFileSync(join(folder, "pace.md"), "Merged.\n");
    conflictsFor(touch("pace.md", "s-1", "PostToolUse", "MultiEdit"), marks);
    expect(JSON.parse(readFileSync(join(folder, SAVED_FILE), "utf8")).saved).toEqual([{ file: "tone.md", hash: hashOf(KEPT) }]);
  });

  it("puts the notes into the context of Claude Code's tool call", async () => {
    listConflicts(conflict("tone.md"));
    const output = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(HOOKS, "memory-conflicts.mjs")], { env: { ...process.env, EVEN_KEEL_AGENT: "", TMPDIR: root, TEMP: root, TMP: root } });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.on("close", () => resolve(stdout));
      child.stdin.end(JSON.stringify(touch("tone.md", "s-spawn")));
    });
    expect(JSON.parse(output)).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "merge tone.md" } });
  });
});
