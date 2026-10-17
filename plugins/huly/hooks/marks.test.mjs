import { describe, expect, it } from "vitest";
import { codeInsideMarks, offendersIn } from "./marks.mjs";

describe("codeInsideMarks", () => {
  it("finds inline code inside bold", () => {
    expect(codeInsideMarks("1. **Keep it, read along `superseded_by`** to the end")).toEqual([
      "**Keep it, read along `superseded_by`**",
    ]);
  });

  it("finds inline code inside italics, strikethrough and a link", () => {
    expect(codeInsideMarks("*see `a`*")).toHaveLength(1);
    expect(codeInsideMarks("_see `a`_")).toHaveLength(1);
    expect(codeInsideMarks("__see `a`__")).toHaveLength(1);
    expect(codeInsideMarks("~~old `a`~~")).toHaveLength(1);
    expect(codeInsideMarks("[the `a` function](https://example.com)")).toHaveLength(1);
  });

  it("finds bold that wraps only the code", () => {
    expect(codeInsideMarks("**`Core`**")).toHaveLength(1);
  });

  it("accepts code next to emphasis", () => {
    expect(codeInsideMarks("**text** `Core` and *more* `x`")).toEqual([]);
    expect(codeInsideMarks("**a** then `b` then **c**")).toEqual([]);
    expect(codeInsideMarks("__a__ then `b` then __c__")).toEqual([]);
  });

  it("does not take a closing delimiter before punctuation for an opening one", () => {
    expect(codeInsideMarks("- **Один плагин**, не копия: `a`.\n- **Различия** — `b`")).toEqual([]);
    expect(codeInsideMarks("- *one*, then `a`.\n- *two*")).toEqual([]);
    expect(codeInsideMarks("- __one__, then `a`.\n- __two__")).toEqual([]);
    expect(codeInsideMarks("- **one**, then **two `a`**")).toEqual(["**two `a`**"]);
  });

  it("ignores emphasis characters inside code spans", () => {
    expect(codeInsideMarks("`**not bold**` and `a*b*c` and `snake_case_name`")).toEqual([]);
    expect(codeInsideMarks("`a_b` then `c_d`")).toEqual([]);
  });

  it("ignores list markers, products and intraword underscores", () => {
    expect(codeInsideMarks("* item `a`\n* item `b`")).toEqual([]);
    expect(codeInsideMarks("2 * `x` * 3")).toEqual([]);
    expect(codeInsideMarks("my_var `x` other_var")).toEqual([]);
  });

  it("ignores fenced code blocks", () => {
    expect(codeInsideMarks("```\n**a `b`**\n```")).toEqual([]);
  });

  it("does not join emphasis across paragraphs", () => {
    expect(codeInsideMarks("**a**\n\n`b` and **c**")).toEqual([]);
  });

  it("finds emphasis that spans lines of one paragraph", () => {
    expect(codeInsideMarks("**a\n`b`**")).toHaveLength(1);
  });
});

describe("offendersIn", () => {
  it("checks every string of the tool input", () => {
    expect(offendersIn({ project: "ABC", identifier: "ABC-1", description: "**a `b`**" })).toEqual(["**a `b`**"]);
    expect(offendersIn({ body: "fine `b`", nested: ["*x `y`*"] })).toEqual(["*x `y`*"]);
    expect(offendersIn(null)).toEqual([]);
  });
});
