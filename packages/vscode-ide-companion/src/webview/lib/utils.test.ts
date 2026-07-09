/**
 * Unit tests for lib/utils.ts
 *
 * Tests cover:
 * - cn() function (clsx + tailwind-merge)
 */

import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("returns empty string for no args", () => {
    expect(cn()).toBe("");
  });

  it("returns single class", () => {
    expect(cn("text-red-500")).toBe("text-red-500");
  });

  it("combines multiple classes", () => {
    expect(cn("text-red-500", "bg-blue-500")).toBe("text-red-500 bg-blue-500");
  });

  it("handles conditional classes (falsy values)", () => {
    const falsy = false;
    expect(cn("base", falsy && "hidden", undefined, null, "visible")).toBe("base visible");
  });

  it("handles object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("handles array syntax", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("merges conflicting color classes", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles complex merge scenarios", () => {
    const result = cn("px-2 py-1 text-sm", "px-4", { "bg-red-500": true, "bg-blue-500": false }, "py-2");
    // Should contain all expected classes, order may vary due to tailwind-merge
    expect(result).toContain("text-sm");
    expect(result).toContain("px-4");
    expect(result).toContain("bg-red-500");
  });

  it("handles empty strings", () => {
    expect(cn("", "test", "")).toBe("test");
  });
});
