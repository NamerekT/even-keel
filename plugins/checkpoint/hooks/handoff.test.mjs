import { describe, expect, it } from "vitest";
import { hasMark, missingMark } from "./handoff.mjs";

const prompt = (text) => ({ type: "user", message: { content: text } });
const result = () => ({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } });
const call = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const note = (path = ".temp/handoff.md") => call("Write", { file_path: path, content: "..." });
const bash = (command) => call("Bash", { command });

describe("hasMark", () => {
  it("takes the mark on the last line, with or without markdown", () => {
    expect(hasMark("Done.\n\nCHECKPOINT: .temp/handoff.md\n")).toBe(true);
    expect(hasMark("Done.\n`CHECKPOINT: .temp/handoff.md`")).toBe(true);
    expect(hasMark("**CHECKPOINT:** `.temp/handoff.md`  ")).toBe(true);
  });

  it("rejects a mark that is not the last line, and an empty message", () => {
    expect(hasMark("CHECKPOINT: .temp/handoff.md\nDetails are in the note.")).toBe(false);
    expect(hasMark("")).toBe(false);
    expect(hasMark(undefined)).toBe(false);
  });
});

describe("missingMark", () => {
  it("catches a note written at the end of the turn without the mark", () => {
    const entries = [prompt("CBL-1"), bash("git commit -m wip"), result(), note(), result()];
    expect(missingMark(entries, "The checkpoint is ready. Details are in .temp/handoff.md.")).toBe(true);
  });

  it("accepts the same turn when the mark is there", () => {
    const entries = [prompt("CBL-1"), note(), result()];
    expect(missingMark(entries, "Ready.\n\nCHECKPOINT: .temp/handoff.md")).toBe(false);
  });

  it("matches the note by an absolute Windows path and by Edit", () => {
    expect(missingMark([prompt("x"), note("D:\\work\\tree\\.temp\\handoff.md")], "Ready.")).toBe(true);
    expect(missingMark([prompt("x"), call("Edit", { file_path: "/w/.temp/handoff.md" })], "Ready.")).toBe(true);
  });

  it("leaves a turn alone that carried on well after the note", () => {
    const entries = [prompt("x"), note(), result(), bash("npm test"), result(), bash("git merge"), result(), bash("git log"), result()];
    expect(missingMark(entries, "Merged.")).toBe(false);
  });

  it("leaves a turn alone that wrote no note, or a note from an earlier turn", () => {
    expect(missingMark([prompt("x"), bash("npm test")], "Done.")).toBe(false);
    expect(missingMark([prompt("x"), note(), result(), prompt("go on")], "Done.")).toBe(false);
  });

  it("ignores other files named handoff and subagent calls", () => {
    expect(missingMark([prompt("x"), note("docs/handoff.md")], "Done.")).toBe(false);
    expect(missingMark([prompt("x"), { ...note(), isSidechain: true }], "Done.")).toBe(false);
  });

  it("does not take meta entries for a prompt", () => {
    const entries = [prompt("x"), note(), { type: "user", isMeta: true, message: { content: [{ type: "text", text: "caveat" }] } }];
    expect(missingMark(entries, "Ready.")).toBe(true);
  });
});
