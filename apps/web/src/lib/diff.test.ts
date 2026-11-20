import { describe, expect, it } from "vitest";
import { changedLines } from "./diff";

describe("changedLines", () => {
  it("marks inserted and edited lines only", () => {
    expect([...changedLines("a\nb\nc", "a\nB\nc\nd")]).toEqual([1, 3]);
    expect(changedLines("x", "x").size).toBe(0);
    expect([...changedLines("", "first")]).toEqual([0]);
  });
});
