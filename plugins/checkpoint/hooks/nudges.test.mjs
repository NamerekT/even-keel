import { describe, expect, it } from "vitest";
import { askFrom, isDue, markOf, nudge, planOf } from "./nudges.mjs";

const marksOf = (plan, sizes) => sizes.map((size) => markOf(size, plan));

describe("planOf", () => {
  it("starts at 200k on its own, with the later nudges where they were", () => {
    expect(planOf({}, null)).toEqual({
      first: 200_000,
      step: 50_000,
      late: 250_000,
      lateStep: 25_000,
      hard: 300_000,
      maxHandoffs: 3,
      handoffs: 0,
      held: false,
    });
  });

  it("takes thresholds from the environment and ignores what is not a positive number", () => {
    const env = { CHECKPOINT_FIRST_TOKENS: "120000", CHECKPOINT_STEP_TOKENS: "x", CHECKPOINT_HARD_TOKENS: "-1", CHECKPOINT_MAX_HANDOFFS: "5" };
    expect(planOf(env, null)).toMatchObject({ first: 120_000, step: 50_000, hard: 300_000, maxHandoffs: 5 });
  });

  it("takes a calibrated or pinned threshold from Even Keel over the environment", () => {
    const env = { CHECKPOINT_FIRST_TOKENS: "120000" };
    expect(planOf(env, { first: 187_000, source: "calibrated", handoffs: 1 })).toMatchObject({ first: 187_000, handoffs: 1, held: false });
    expect(planOf(env, { first: 160_000, source: "config", handoffs: 0 }).first).toBe(160_000);
  });

  it("keeps its own threshold when Even Keel has only the default", () => {
    expect(planOf({ CHECKPOINT_FIRST_TOKENS: "120000" }, { first: 200_000, source: "default", handoffs: 0 }).first).toBe(120_000);
    expect(planOf({}, { first: "many", source: "calibrated", handoffs: 0 }).first).toBe(200_000);
  });

  it("holds the nudges until the hard threshold once the task has had its handoffs", () => {
    expect(planOf({}, { first: 187_000, source: "calibrated", handoffs: 2 })).toMatchObject({ first: 187_000, held: false });
    expect(planOf({}, { first: 187_000, source: "calibrated", handoffs: 3 })).toMatchObject({ first: 300_000, handoffs: 3, held: true });
    expect(planOf({ CHECKPOINT_MAX_HANDOFFS: "1" }, { first: 200_000, source: "default", handoffs: 1 })).toMatchObject({ first: 300_000, held: true });
  });
});

describe("markOf", () => {
  it("marks the first threshold, the late one and every late step past it", () => {
    const plan = planOf({}, null);
    expect(marksOf(plan, [199_999, 200_000, 249_999, 250_000, 274_999, 275_000, 301_000])).toEqual([0, 200_000, 200_000, 250_000, 250_000, 275_000, 300_000]);
  });

  it("steps between the first threshold and the late one", () => {
    const plan = planOf({ CHECKPOINT_FIRST_TOKENS: "150000" }, null);
    expect(marksOf(plan, [149_000, 150_000, 199_000, 200_000, 250_000])).toEqual([0, 150_000, 150_000, 200_000, 250_000]);
  });

  it("skips a step that lands right before the late threshold", () => {
    const plan = planOf({}, { first: 193_000, source: "calibrated", handoffs: 0 });
    expect(marksOf(plan, [193_000, 243_000, 249_999, 250_000])).toEqual([193_000, 193_000, 193_000, 250_000]);
    expect(markOf(240_000, planOf({ CHECKPOINT_FIRST_TOKENS: "240000" }, null))).toBe(240_000);
  });

  it("is silent below the hard threshold for a held task", () => {
    const plan = planOf({}, { first: 187_000, source: "calibrated", handoffs: 3 });
    expect(marksOf(plan, [250_000, 299_999, 300_000, 330_000])).toEqual([0, 0, 300_000, 325_000]);
  });
});

describe("nudge", () => {
  it("lets the session pick the moment the first time and not after", () => {
    const plan = planOf({}, null);
    expect(nudge(201_400, 0, plan)).toMatch(/^Context is now ~201k tokens.*checkpoint at the next stable point instead\.$/s);
    expect(nudge(251_000, 200_000, plan)).toMatch(/You were already asked for a checkpoint and carried on/);
  });

  it("tells a held task why it was not asked earlier", () => {
    const plan = planOf({}, { first: 187_000, source: "calibrated", handoffs: 4 });
    const text = nudge(300_500, 0, plan);
    expect(text).toMatch(/already been handed over 4 times/);
    expect(text).not.toMatch(/next stable point/);
    expect(nudge(326_000, 300_000, plan)).toMatch(/You were already asked/);
  });
});

describe("asking Even Keel", () => {
  it("starts at 100k, or at the first threshold when that is lower", () => {
    expect(askFrom({})).toBe(100_000);
    expect(askFrom({ CHECKPOINT_FIRST_TOKENS: "60000" })).toBe(60_000);
  });

  it("asks once, again in an hour after an answer and in five minutes after a failure", () => {
    const now = 10 * 60 * 60 * 1000;
    expect(isDue({ mark: 0 }, now)).toBe(true);
    expect(isDue({ mark: 0, askedAt: now - 59 * 60 * 1000, ok: true }, now)).toBe(false);
    expect(isDue({ mark: 0, askedAt: now - 61 * 60 * 1000, ok: true }, now)).toBe(true);
    expect(isDue({ mark: 0, askedAt: now - 4 * 60 * 1000, ok: false }, now)).toBe(false);
    expect(isDue({ mark: 0, askedAt: now - 6 * 60 * 1000, ok: false }, now)).toBe(true);
  });
});
