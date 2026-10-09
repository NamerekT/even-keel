import { describe, expect, it } from "vitest";
import { calibrationText, estimateCall } from "./calibration.mjs";

const TOOL = "mcp__plugin_huly_huly__";

describe("estimateCall", () => {
  it("takes the project of a new issue with an estimate", () => {
    expect(estimateCall(TOOL + "create_issue", { project: "abc", title: "x", estimation: 0.33 })).toEqual({
      project: "ABC",
      task: null,
    });
  });

  it("takes the task of an update, a bare number included", () => {
    expect(estimateCall(TOOL + "update_issue", { project: "ABC", identifier: "ABC-12", estimation: 0.17 })).toEqual({
      project: "ABC",
      task: "ABC-12",
    });
    expect(estimateCall(TOOL + "update_issue", { project: "ABC", identifier: "12", estimation: 0.17 })).toMatchObject({
      task: "ABC-12",
    });
  });

  it("ignores calls without an estimate, a cleared one and other tools", () => {
    expect(estimateCall(TOOL + "update_issue", { project: "ABC", identifier: "ABC-1", title: "x" })).toBeNull();
    expect(estimateCall(TOOL + "update_issue", { project: "ABC", identifier: "ABC-1", estimation: null })).toBeNull();
    expect(estimateCall(TOOL + "add_comment", { project: "ABC", estimation: 1 })).toBeNull();
    expect(estimateCall(TOOL + "create_issue", { estimation: 1 })).toBeNull();
  });

  it("leaves the task out when the identifier is not one", () => {
    expect(estimateCall(TOOL + "update_issue", { project: "ABC", identifier: "6ac9", estimation: 1 })).toMatchObject({
      task: null,
    });
  });
});

const step = (minutes, closed, median = null, low = null, high = null) => ({
  minutes,
  closed,
  median,
  low,
  high,
  thin: closed < 5,
});

const calibration = {
  project: "ABC",
  component: "Web",
  closed: 9,
  estimated: 7,
  thin: false,
  steps: [step(5, 0), step(10, 6, 12.4, 8, 15.6), step(20, 1, 0.3, 0.3, 0.3), step(40, 0), step(80, 0)],
  scope: "component",
  recent: [
    { task: "ABC-9", title: "Fix the badge", component: "Web", estimateMin: 10, activeMin: 7.6 },
    { task: "ABC-7", title: null, component: "Web", estimateMin: null, activeMin: 31 },
  ],
};

describe("calibrationText", () => {
  it("lists each step and the recent tasks of the component", () => {
    const text = calibrationText(calibration);
    expect(text).toContain("project ABC");
    expect(text).not.toContain("- 5 min");
    expect(text).toContain("- 10 min: 6 tasks → median 12, middle half 8–16");
    expect(text).toContain("- 20 min: 1 task → median <1, middle half <1–<1 (thin data)");
    expect(text).toContain("Recent closed tasks of component Web");
    expect(text).toContain("- ABC-9 Fix the badge: 10 → 8");
    expect(text).toContain("- ABC-7: no estimate → 31");
    expect(text).not.toContain("Few closed tasks");
  });

  it("warns when the project has few estimated tasks and names components of project-wide tasks", () => {
    const text = calibrationText({ ...calibration, thin: true, estimated: 2, scope: "project" });
    expect(text).toContain("Few closed tasks carry an estimate on this scale (2)");
    expect(text).toContain("Recent closed tasks of the project");
    expect(text).toContain("- ABC-9 Fix the badge [Web]: 10 → 8");
  });

  it("says so in one line when no closed task sits on a step", () => {
    const empty = [5, 10, 20, 40, 80].map((minutes) => step(minutes, 0));
    const text = calibrationText({ ...calibration, thin: true, estimated: 0, steps: empty });
    expect(text).toContain("No closed task carries an estimate on this scale yet");
    expect(text).not.toContain("min:");
    expect(text).not.toContain("Few closed tasks");
  });

  it("has nothing to say without closed tasks", () => {
    expect(calibrationText({ ...calibration, closed: 0, estimated: 0, recent: [] })).toBeNull();
  });
});
