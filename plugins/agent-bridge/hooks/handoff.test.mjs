import { describe, expect, it } from "vitest";
import { hasMark, isKeptCall, KEPT, markOf, noteIn } from "./handoff.mjs";

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

  it("takes the bare line of a note kept with Even Keel (BTN-1046)", () => {
    expect(hasMark("Kept.\n\nCHECKPOINT:")).toBe(true);
    expect(hasMark("**CHECKPOINT:**")).toBe(true);
    expect(hasMark("CHECKPOINT:\nmore")).toBe(false);
  });
});

describe("the kept note (BTN-1046)", () => {
  it("is named by the tool, keeps its bare line and is recognized under an agent's tool names", () => {
    expect(noteIn(KEPT)).toBe("handoff_write");
    expect(markOf(KEPT)).toBe("CHECKPOINT:");
    expect(markOf(".temp/handoff.md")).toBe("CHECKPOINT: .temp/handoff.md");
    for (const name of ["handoff_write", "tasks_handoff_write", "mcp__plugin_tasks_tasks__handoff_write", "tasks.handoff_write"]) {
      expect(isKeptCall(name)).toBe(true);
    }
    expect(isKeptCall("handoff_write_old")).toBe(false);
    expect(isKeptCall(undefined)).toBe(false);
  });
});
