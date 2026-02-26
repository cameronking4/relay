import { describe, expect, it } from "vitest";
import { composeTaskPrompt } from "./composeTaskPrompt";

describe("composeTaskPrompt", () => {
  it("returns the task prompt unchanged when instructions are missing", () => {
    expect(composeTaskPrompt("Implement feature X")).toBe(
      "Implement feature X"
    );
  });

  it("returns the task prompt unchanged when instructions are whitespace only", () => {
    expect(composeTaskPrompt("Fix bug Y", "   \n\t  ")).toBe("Fix bug Y");
  });

  it("joins prompt and instructions with exactly two newlines", () => {
    expect(composeTaskPrompt("Fix login flow", "Use zod for validation")).toBe(
      "Fix login flow\n\nUse zod for validation"
    );
  });

  it("preserves multiline custom instructions", () => {
    expect(
      composeTaskPrompt(
        "Refactor task queue",
        "Prefer small functions\nAdd tests for retries\nDocument edge cases"
      )
    ).toBe(
      "Refactor task queue\n\nPrefer small functions\nAdd tests for retries\nDocument edge cases"
    );
  });
});
