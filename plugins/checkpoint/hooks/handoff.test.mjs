import { describe, expect, it } from "vitest";
import { hasMark } from "./handoff.mjs";

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
