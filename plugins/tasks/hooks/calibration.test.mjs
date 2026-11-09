import { describe, expect, it } from "vitest";
import { calibrationText, estimateCall, mismatch } from "./calibration.mjs";

const TOOL = "mcp__plugin_tasks_tasks__";

describe("estimateCall", () => {
  it("takes the project and task of an update from its key", () => {
    expect(estimateCall(TOOL + "task_update", { key: "abc-12", estimate: 10 })).toEqual({ project: "ABC", task: "ABC-12", minutes: 10 });
  });

  it("takes the project of a batch from tracker, then project, then the task worktree", () => {
    const batch = { tasks: [{ title: "a" }, { title: "b", estimate: 20 }] };
    expect(estimateCall(TOOL + "tasks_create", { ...batch, tracker: "abcgh", project: "ABC" })).toEqual({ project: "ABCGH", task: null, minutes: 20 });
    expect(estimateCall(TOOL + "tasks_create", { ...batch, project: "abc" })).toMatchObject({ project: "ABC" });
    expect(estimateCall(TOOL + "tasks_create", batch, "D:\\repo\\.claude\\worktrees\\btn-893")).toMatchObject({ project: "BTN" });
    expect(estimateCall(TOOL + "tasks_create", batch, "/home/john/repo")).toBeNull();
  });

  it("ignores calls without an estimate and other tools", () => {
    expect(estimateCall(TOOL + "task_update", { key: "ABC-1", title: "x" })).toBeNull();
    expect(estimateCall(TOOL + "tasks_create", { project: "ABC", tasks: [{ title: "x" }] })).toBeNull();
    expect(estimateCall(TOOL + "task_comment", { key: "ABC-1", estimate: 10 })).toBeNull();
    expect(estimateCall("mcp__plugin_huly_huly__update_issue", { key: "ABC-1", estimate: 10 })).toBeNull();
  });

  it("matches the OpenCode name of the gateway's tools", () => {
    expect(estimateCall("plugin_tasks_tasks_task_update", { key: "ABC-1", estimate: 5 })).toMatchObject({ project: "ABC" });
  });
});

const step = (minutes, closed, median = null) => ({ minutes, closed, median, low: median, high: median, thin: closed < 5 });

describe("mismatch and calibrationText in minutes", () => {
  const steps = [step(5, 0), step(10, 6, 5.7), step(20, 23, 9.8), step(40, 50, 19.9), step(80, 3, 49)];
  const data = { project: "ABC", closed: 82, estimated: 82, thin: false, scope: "project", recent: [], steps };

  it("names the step nearest the median of the minutes sent", () => {
    expect(mismatch(data, 40)).toEqual({ minutes: 40, median: 19.9, nearest: 20 });
    expect(mismatch(data, 80)).toBeNull();
    expect(mismatch(data, 30)).toBeNull();
  });

  it("asks for a corrected estimate through task_update and speaks no hours", () => {
    expect(calibrationText(data)).toContain("send task_update with a corrected one");
    const refused = calibrationText(data, { minutes: 40, median: 19.9, nearest: 20 });
    expect(refused).toContain("the nearest step is 20 min.");
    expect(refused).not.toContain("0.33");
  });
});
